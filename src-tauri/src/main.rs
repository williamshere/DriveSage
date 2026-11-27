#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rayon::prelude::*;
use rusqlite::{Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;

// ---------- helpers ----------

// Prefer the absolute path so detection works even when PATH is restricted.
fn powershell_exe() -> PathBuf {
    if let Some(root) = std::env::var_os("SystemRoot") {
        let candidate = PathBuf::from(root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from("powershell")
}

fn run_powershell(script: &str) -> Result<String, String> {
    // Emit UTF-8 bytes straight to stdout so output never depends on the console code page.
    let script = format!(
        "$__out = (& {{ {} }} | Out-String); $__bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($__out); $__stdout = [Console]::OpenStandardOutput(); $__stdout.Write($__bytes, 0, $__bytes.Length); $__stdout.Flush()",
        script
    );
    let mut command = Command::new(powershell_exe());
    command.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console flash in the GUI app.
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .output()
        .map_err(|e| format!("powershell spawn failed: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("powershell error: {}", stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn db_path() -> PathBuf {
    if let Some(mut p) = dirs::data_local_dir() {
        p.push("DriveSage");
        let _ = std::fs::create_dir_all(&p);
        p.push("drivesage.db");
        p
    } else {
        PathBuf::from("drivesage.db")
    }
}

fn get_db() -> Result<Connection, String> {
    let path = db_path();
    Connection::open(&path).map_err(|e| e.to_string())
}

fn init_db(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS drives (id TEXT PRIMARY KEY, data TEXT);
         CREATE TABLE IF NOT EXISTS smart_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, drive_id TEXT, ts INTEGER, data TEXT);
         CREATE TABLE IF NOT EXISTS scans (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, data TEXT);
         CREATE TABLE IF NOT EXISTS cleanup_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, data TEXT);
         CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
         CREATE TABLE IF NOT EXISTS alert_log (id INTEGER PRIMARY KEY AUTOINCREMENT, drive_id TEXT, alert_type TEXT, ts INTEGER);
        ",
    )
}

// ---------- data structures ----------

#[derive(Serialize, Deserialize, Debug)]
struct DriveInfo {
    id: String,
    letter: Option<String>,
    model: String,
    serial: String,
    capacity_bytes: Option<u64>,
    free_bytes: Option<u64>,
    temperature: Option<i32>,
    wear_percent: Option<u8>,
    reallocated: Option<u32>,
    pending: Option<u32>,
    crc_errors: Option<u32>,
    power_on_hours: Option<u32>,
    #[serde(rename = "type")]
    drive_type: String,
    health_status: Option<String>,
    bus_type: Option<String>,
}

#[derive(Clone, Default)]
struct ScannerState {
    active: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    progress: Arc<Mutex<ScanProgress>>,
}

#[derive(Clone, Default, Serialize)]
struct ScanProgress {
    phase: String,
    current_root: String,
    files_scanned: u64,
    bytes_scanned: u64,
}

#[derive(Clone, Serialize)]
struct ScannedFile {
    path: String,
    size: u64,
    modified: Option<u64>,
}

#[derive(Serialize)]
struct ScanNode {
    name: String,
    path: String,
    size: u64,
    file_count: u64,
    children: Vec<ScanNode>,
}

struct ScanContext {
    state: ScannerState,
    cancelled: Arc<AtomicBool>,
    file_count: AtomicU64,
    bytes_scanned: AtomicU64,
    unreadable_paths: AtomicU64,
    cap_reached: AtomicBool,
    file_cap: u64,
    max_depth: u8,
    excluded_paths: Vec<String>,
    files: Mutex<Vec<ScannedFile>>,
}

impl ScannerState {
    fn update_progress(
        &self,
        current_root: &str,
        phase: &str,
        files_scanned: u64,
        bytes_scanned: u64,
    ) {
        if let Ok(mut progress) = self.progress.lock() {
            progress.phase = phase.to_string();
            progress.current_root = current_root.to_string();
            progress.files_scanned = files_scanned;
            progress.bytes_scanned = bytes_scanned;
        }
    }
}

impl ScanContext {
    fn should_stop(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed) || self.cap_reached.load(Ordering::Relaxed)
    }

    fn reserve_file(&self) -> bool {
        let mut current = self.file_count.load(Ordering::Relaxed);
        loop {
            if current >= self.file_cap {
                self.cap_reached.store(true, Ordering::Relaxed);
                return false;
            }
            match self.file_count.compare_exchange_weak(
                current,
                current + 1,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return true,
                Err(actual) => current = actual,
            }
        }
    }

    fn update_progress(&self, root: &str, phase: &str) {
        if let Ok(mut progress) = self.state.progress.lock() {
            progress.phase = phase.to_string();
            progress.current_root = root.to_string();
            progress.files_scanned = self.file_count.load(Ordering::Relaxed);
            progress.bytes_scanned = self.bytes_scanned.load(Ordering::Relaxed);
        }
    }
}

// ---------- Tauri commands ----------
// 1. drives — Detect every fixed/removable volume and map it to its physical disk (read-only)
const DRIVE_SCRIPT: &str = r#"
$ErrorActionPreference='SilentlyContinue'
function Get-BackingPhysicalDisk($letter) {
  try {
    $partitions = @(Get-Partition -DriveLetter $letter -ErrorAction Stop)
    if ($partitions.Count -ne 1) { return }
    $osDisks = @(Get-Disk -Partition $partitions[0] -ErrorAction Stop)
    if ($osDisks.Count -ne 1) { return }
    $osDisk = $osDisks[0]
    $virtualDisks = @(Get-CimAssociatedInstance -Namespace 'root/Microsoft/Windows/Storage' -InputObject $osDisk -ResultClassName MSFT_VirtualDisk -ErrorAction Stop)
    if ($virtualDisks.Count -gt 1) { return }
    if ($virtualDisks.Count -eq 1) {
      $physicalDisks = @(Get-PhysicalDisk -VirtualDisk $virtualDisks[0] -ErrorAction Stop)
    } else {
      $physicalDisks = @(Get-CimAssociatedInstance -Namespace 'root/Microsoft/Windows/Storage' -InputObject $osDisk -ResultClassName MSFT_PhysicalDisk -ErrorAction Stop)
      if ($physicalDisks.Count -eq 0) {
        $counters = @(Get-CimAssociatedInstance -Namespace 'root/Microsoft/Windows/Storage' -InputObject $osDisk -ResultClassName MSFT_StorageReliabilityCounter -ErrorAction Stop)
        if ($counters.Count -ne 1) { return }
        $physicalDisks = @(Get-CimAssociatedInstance -Namespace 'root/Microsoft/Windows/Storage' -InputObject $counters[0] -ResultClassName MSFT_PhysicalDisk -ErrorAction Stop)
      }
    }
    if ($physicalDisks.Count -eq 1) { return $physicalDisks[0] }
  } catch {}
}
$rows=@()
foreach ($d in [System.IO.DriveInfo]::GetDrives()) {
  if (($d.DriveType -ne 'Fixed' -and $d.DriveType -ne 'Removable') -or -not $d.IsReady) { continue }
  $letter = $d.Name.Substring(0,1)
  $disk = $null
  $physical = Get-BackingPhysicalDisk $letter
  if ($physical) {
    $c=$null
    try { $c = $physical | Get-StorageReliabilityCounter -ErrorAction Stop } catch {}
    $disk = [pscustomobject]@{
      model=$physical.FriendlyName; serial=$physical.SerialNumber; media=[string]$physical.MediaType;
      bus=[string]$physical.BusType; health=[string]$physical.HealthStatus;
      temp=$c.Temperature; wear=$c.Wear; hours=$c.PowerOnHours
    }
  }
  $rows += [pscustomobject]@{ letter=$letter; total=$d.TotalSize; free=$d.AvailableFreeSpace; removable=($d.DriveType -eq 'Removable'); disk=$disk }
}
ConvertTo-Json -InputObject @($rows) -Depth 4 -Compress
"#;

fn classify_drive_type(media: &str, bus: &str) -> String {
    let media = media.to_lowercase();
    let bus = bus.to_lowercase();
    if bus == "nvme" {
        "NVMe".to_string()
    } else if bus == "usb" {
        "USB".to_string()
    } else if media == "ssd" {
        "SSD".to_string()
    } else if media == "hdd" {
        "HDD".to_string()
    } else {
        "Unknown".to_string()
    }
}

fn non_empty(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn parse_drive_rows(json: &str) -> Result<Vec<DriveInfo>, String> {
    let value: serde_json::Value = serde_json::from_str(json.trim().trim_start_matches('\u{feff}'))
        .map_err(|e| format!("could not read drive list: {e}"))?;
    let rows = match value {
        serde_json::Value::Array(rows) => rows,
        serde_json::Value::Null => Vec::new(),
        single => vec![single],
    };
    let mut drives = Vec::new();
    for row in rows {
        let Some(letter) = non_empty(row.get("letter")).map(|l| l.to_uppercase()) else {
            continue;
        };
        let disk = row.get("disk").filter(|d| d.is_object());
        let field = |name: &str| disk.and_then(|d| d.get(name));
        let media = non_empty(field("media")).unwrap_or_default();
        let bus = non_empty(field("bus"));
        // Windows reports 0 (or nothing) when a drive does not expose a temperature.
        let temperature = field("temp")
            .and_then(|v| v.as_i64())
            .filter(|t| *t > 0 && *t < 150)
            .map(|t| t as i32);
        drives.push(DriveInfo {
            id: format!("drive-{letter}"),
            letter: Some(format!("{letter}:")),
            model: non_empty(field("model")).unwrap_or_else(|| "Unknown model".to_string()),
            serial: non_empty(field("serial")).unwrap_or_else(|| "unavailable".to_string()),
            capacity_bytes: row.get("total").and_then(|v| v.as_u64()),
            free_bytes: row.get("free").and_then(|v| v.as_u64()),
            temperature,
            wear_percent: field("wear")
                .and_then(|v| v.as_u64())
                .filter(|w| *w <= 100)
                .map(|w| w as u8),
            reallocated: None,
            pending: None,
            crc_errors: None,
            power_on_hours: field("hours").and_then(|v| v.as_u64()).map(|h| h as u32),
            drive_type: classify_drive_type(&media, bus.as_deref().unwrap_or("")),
            health_status: non_empty(field("health")),
            bus_type: bus,
        });
    }
    Ok(drives)
}

fn collect_drives() -> Result<Vec<DriveInfo>, String> {
    parse_drive_rows(&run_powershell(DRIVE_SCRIPT)?)
}

#[tauri::command]
fn drives() -> Result<serde_json::Value, String> {
    let drives = collect_drives()?;
    let wmi_available = drives.iter().any(|d| d.bus_type.is_some());
    Ok(serde_json::json!({ "drives": drives, "wmi_available": wmi_available }))
}

// 2. smart — Counters for one drive's physical disk; unavailable values stay null (read-only)
#[tauri::command]
fn smart(drive_id: String) -> Result<serde_json::Value, String> {
    let drive = collect_drives()?.into_iter().find(|d| d.id == drive_id);
    Ok(match drive {
        Some(d) => serde_json::json!({
            "drive_id": drive_id,
            "available": d.temperature.is_some() || d.wear_percent.is_some() || d.power_on_hours.is_some(),
            "temperature": d.temperature,
            "wear_percent": d.wear_percent,
            "power_on_hours": d.power_on_hours,
            "reallocated": d.reallocated,
            "pending": d.pending,
            "crc_errors": d.crc_errors,
            "health_status": d.health_status,
            "note": "Read-only via Get-StorageReliabilityCounter; null means the drive does not expose the value to Windows."
        }),
        None => serde_json::json!({ "drive_id": drive_id, "available": false, "note": "Drive not found." }),
    })
}

fn normalize_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    let value = value.strip_prefix(r"\\?\").unwrap_or(&value);
    value.trim_end_matches('\\').to_lowercase()
}

fn path_is_excluded(path: &Path, excluded_paths: &[String]) -> bool {
    let path = normalize_path(path);
    excluded_paths
        .iter()
        .any(|excluded| path == *excluded || path.starts_with(&format!("{}\\", excluded)))
}

fn default_excluded_paths() -> Vec<String> {
    let protected = [
        dirs::document_dir(),
        dirs::picture_dir(),
        dirs::desktop_dir(),
        dirs::download_dir(),
    ];
    protected
        .into_iter()
        .flatten()
        .map(|path| normalize_path(&path))
        .collect()
}

fn is_system_directory(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "windows"
            | "program files"
            | "program files (x86)"
            | "programdata"
            | "system volume information"
            | "$recycle.bin"
            | "recovery"
            | "perflogs"
    )
}

#[cfg(windows)]
fn is_hidden_or_system(metadata: &fs::Metadata, _path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & (0x2 | 0x4) != 0
}

#[cfg(not(windows))]
fn is_hidden_or_system(_metadata: &fs::Metadata, path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

fn local_scan_roots() -> Result<Vec<PathBuf>, String> {
    let script = r#"
        $roots = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType = 2 OR DriveType = 3' |
            ForEach-Object { "$($_.DeviceID)\" });
        ConvertTo-Json -InputObject $roots -Compress
    "#;
    let output = run_powershell(script)?;
    let value: serde_json::Value = serde_json::from_str(&output)
        .map_err(|error| format!("could not read local drive list: {error}"))?;
    let paths = match value {
        serde_json::Value::Array(paths) => paths,
        serde_json::Value::String(path) => vec![serde_json::Value::String(path)],
        _ => Vec::new(),
    };
    let roots: Vec<PathBuf> = paths
        .into_iter()
        .filter_map(|path| path.as_str().map(PathBuf::from))
        .filter(|path| path.is_dir())
        .collect();
    if roots.is_empty() {
        return Err("No accessible local drives were found.".to_string());
    }
    Ok(roots)
}

fn modified_seconds(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|time| time.as_secs())
}

fn scan_directory(path: PathBuf, depth: u8, root_name: &str, context: &ScanContext) -> ScanNode {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string_lossy().trim_end_matches('\\').to_string());
    let mut node = ScanNode {
        name,
        path: path.to_string_lossy().to_string(),
        size: 0,
        file_count: 0,
        children: Vec::new(),
    };
    if context.should_stop() {
        return node;
    }
    if depth == 0 {
        context.update_progress(root_name, "Scanning local files");
    }
    let entries = match fs::read_dir(&path) {
        Ok(entries) => entries,
        Err(_) => {
            context.unreadable_paths.fetch_add(1, Ordering::Relaxed);
            return node;
        }
    };
    let mut directories = Vec::new();
    let mut scanned_files = Vec::new();
    for entry in entries {
        if context.should_stop() {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                context.unreadable_paths.fetch_add(1, Ordering::Relaxed);
                continue;
            }
        };
        let child_path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => {
                context.unreadable_paths.fetch_add(1, Ordering::Relaxed);
                continue;
            }
        };
        if file_type.is_symlink() || path_is_excluded(&child_path, &context.excluded_paths) {
            continue;
        }
        if file_type.is_dir()
            && child_path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_system_directory)
        {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => {
                context.unreadable_paths.fetch_add(1, Ordering::Relaxed);
                continue;
            }
        };
        if is_hidden_or_system(&metadata, &child_path) {
            continue;
        }
        if file_type.is_dir() {
            if depth < context.max_depth {
                directories.push(child_path);
            }
        } else if file_type.is_file() {
            if !context.reserve_file() {
                break;
            }
            let size = metadata.len();
            node.size = node.size.saturating_add(size);
            node.file_count = node.file_count.saturating_add(1);
            context.bytes_scanned.fetch_add(size, Ordering::Relaxed);
            let files_scanned = context.file_count.load(Ordering::Relaxed);
            scanned_files.push(ScannedFile {
                path: child_path.to_string_lossy().to_string(),
                size,
                modified: modified_seconds(&metadata),
            });
            if files_scanned % 128 == 0 {
                context.update_progress(root_name, "Scanning local files");
            }
        }
    }
    if let Ok(mut files) = context.files.lock() {
        files.extend(scanned_files);
    }
    node.children = directories
        .into_par_iter()
        .map(|directory| scan_directory(directory, depth.saturating_add(1), root_name, context))
        .collect();
    for child in &node.children {
        node.size = node.size.saturating_add(child.size);
        node.file_count = node.file_count.saturating_add(child.file_count);
    }
    node.children
        .sort_by(|left, right| right.size.cmp(&left.size));
    node
}

fn hash_file(
    file: &ScannedFile,
    first_block_only: bool,
    cancelled: &AtomicBool,
) -> Option<Vec<u8>> {
    if cancelled.load(Ordering::Relaxed) {
        return None;
    }
    let path = Path::new(&file.path);
    let before = fs::metadata(path).ok()?;
    if before.len() != file.size || modified_seconds(&before) != file.modified {
        return None;
    }
    let mut input = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    if first_block_only {
        let mut block = [0u8; 4096];
        let read = input.read(&mut block).ok()?;
        hasher.update(&block[..read]);
    } else {
        let mut block = [0u8; 64 * 1024];
        loop {
            if cancelled.load(Ordering::Relaxed) {
                return None;
            }
            let read = input.read(&mut block).ok()?;
            if read == 0 {
                break;
            }
            hasher.update(&block[..read]);
        }
    }
    let after = fs::metadata(path).ok()?;
    if after.len() != file.size || modified_seconds(&after) != file.modified {
        return None;
    }
    Some(hasher.finalize().to_vec())
}

fn find_duplicate_groups(
    files: &[ScannedFile],
    cancelled: &AtomicBool,
) -> Result<(Vec<Vec<ScannedFile>>, u64), String> {
    let mut by_size: HashMap<u64, Vec<&ScannedFile>> = HashMap::new();
    for file in files {
        if file.size > 0 {
            by_size.entry(file.size).or_default().push(file);
        }
    }
    let mut duplicate_groups = Vec::new();
    let mut reclaimable = 0u64;
    for same_size in by_size.into_values().filter(|group| group.len() > 1) {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Scan stopped.".to_string());
        }
        let mut by_first_block: HashMap<Vec<u8>, Vec<&ScannedFile>> = HashMap::new();
        for file in same_size {
            if let Some(hash) = hash_file(file, true, cancelled) {
                by_first_block.entry(hash).or_default().push(file);
            }
        }
        for first_block_matches in by_first_block.into_values().filter(|group| group.len() > 1) {
            if cancelled.load(Ordering::Relaxed) {
                return Err("Scan stopped.".to_string());
            }
            let mut by_full_hash: HashMap<Vec<u8>, Vec<&ScannedFile>> = HashMap::new();
            for file in first_block_matches {
                if let Some(hash) = hash_file(file, false, cancelled) {
                    by_full_hash.entry(hash).or_default().push(file);
                }
            }
            for matches in by_full_hash.into_values().filter(|group| group.len() > 1) {
                let mut group: Vec<ScannedFile> = matches.into_iter().cloned().collect();
                group.sort_by(|left, right| left.path.cmp(&right.path));
                reclaimable = reclaimable
                    .saturating_add(group[0].size.saturating_mul((group.len() - 1) as u64));
                duplicate_groups.push(group);
            }
        }
    }
    duplicate_groups.sort_by(|left, right| {
        right[0]
            .size
            .cmp(&left[0].size)
            .then_with(|| left[0].path.cmp(&right[0].path))
    });
    Ok((duplicate_groups, reclaimable))
}

fn scan_paths(
    roots: Vec<PathBuf>,
    max_depth: u8,
    file_cap: u32,
    user_exclusions: Vec<String>,
    state: ScannerState,
    cancelled: Arc<AtomicBool>,
) -> Result<serde_json::Value, String> {
    if roots.is_empty() {
        return Err("No accessible local drives were found.".to_string());
    }
    let mut excluded_paths = default_excluded_paths();
    excluded_paths.extend(user_exclusions.into_iter().map(|path| {
        let path = PathBuf::from(path);
        let absolute = if path.is_absolute() {
            path
        } else {
            std::env::current_dir().unwrap_or_default().join(path)
        };
        normalize_path(&absolute)
    }));
    let context = ScanContext {
        state: state.clone(),
        cancelled: cancelled.clone(),
        file_count: AtomicU64::new(0),
        bytes_scanned: AtomicU64::new(0),
        unreadable_paths: AtomicU64::new(0),
        cap_reached: AtomicBool::new(false),
        file_cap: u64::from(file_cap),
        max_depth,
        excluded_paths,
        files: Mutex::new(Vec::new()),
    };
    let worker_count = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(2)
        .clamp(1, 8);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(worker_count)
        .build()
        .map_err(|error| format!("could not start scan workers: {error}"))?;
    let root_nodes: Vec<ScanNode> = pool.install(|| {
        roots
            .par_iter()
            .map(|root| {
                let name = root.to_string_lossy().trim_end_matches('\\').to_string();
                scan_directory(root.clone(), 0, &name, &context)
            })
            .collect()
    });
    if cancelled.load(Ordering::Relaxed) {
        return Err("Scan stopped.".to_string());
    }
    context.update_progress("", "Checking duplicate candidates");
    let mut files = {
        let mut scanned_files = context
            .files
            .lock()
            .map_err(|_| "scan file list is unavailable")?;
        std::mem::take(&mut *scanned_files)
    };
    let (duplicate_groups, reclaimable_bytes) = find_duplicate_groups(&files, &cancelled)?;
    files.sort_by(|left, right| right.size.cmp(&left.size));
    files.truncate(20);
    let total_bytes = context.bytes_scanned.load(Ordering::Relaxed);
    let file_count = context.file_count.load(Ordering::Relaxed);
    let capped = context.cap_reached.load(Ordering::Relaxed);
    let unreadable_paths = context.unreadable_paths.load(Ordering::Relaxed);
    state.update_progress(
        "",
        if capped {
            "Scan limit reached"
        } else {
            "Scan complete"
        },
        file_count,
        total_bytes,
    );
    Ok(serde_json::json!({
        "tree": {
            "name": "This PC",
            "path": "",
            "size": total_bytes,
            "file_count": file_count,
            "children": root_nodes
        },
        "file_count": file_count,
        "total_bytes": total_bytes,
        "duplicate_groups": duplicate_groups,
        "reclaimable_bytes": reclaimable_bytes,
        "largest_files": files,
        "capped": capped,
        "max_depth": max_depth,
        "file_cap": file_cap,
        "unreadable_paths": unreadable_paths
    }))
}

#[tauri::command]
async fn scanner(
    state: State<'_, ScannerState>,
    max_depth: Option<u8>,
    file_cap: Option<u32>,
    excluded_paths: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let state = state.inner().clone();
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = state
            .active
            .lock()
            .map_err(|_| "scanner state is unavailable")?;
        if active.is_some() {
            return Err("A scan is already running.".to_string());
        }
        *active = Some(cancelled.clone());
    }
    let max_depth = max_depth.unwrap_or(12).clamp(1, 32);
    let file_cap = file_cap.unwrap_or(500_000).clamp(1, 2_000_000);
    state.update_progress("", "Finding local drives", 0, 0);
    let worker_state = state.clone();
    let worker_cancelled = cancelled.clone();
    let worker_result = tauri::async_runtime::spawn_blocking(move || {
        let roots = local_scan_roots()?;
        if worker_cancelled.load(Ordering::Relaxed) {
            return Err("Scan stopped.".to_string());
        }
        scan_paths(
            roots,
            max_depth,
            file_cap,
            excluded_paths.unwrap_or_default(),
            worker_state,
            worker_cancelled,
        )
    })
    .await;
    if let Ok(mut active) = state.active.lock() {
        if active
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &cancelled))
        {
            *active = None;
        }
    }
    worker_result.map_err(|error| format!("scan worker failed: {error}"))?
}

#[tauri::command]
fn scanner_progress(state: State<'_, ScannerState>) -> Result<ScanProgress, String> {
    state
        .progress
        .lock()
        .map(|progress| progress.clone())
        .map_err(|_| "scanner progress is unavailable".to_string())
}

#[tauri::command]
fn stop_scanner(state: State<'_, ScannerState>) -> Result<bool, String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "scanner state is unavailable")?;
    if let Some(cancelled) = active.as_ref() {
        cancelled.store(true, Ordering::Relaxed);
        if let Ok(mut progress) = state.progress.lock() {
            progress.phase = "Stopping scan".to_string();
        }
        Ok(true)
    } else {
        Ok(false)
    }
}

// 5. cleanup — Build preview per category (read-only preview)
#[tauri::command]
fn cleanup(categories: Option<Vec<String>>) -> Result<serde_json::Value, String> {
    let cats = categories
        .unwrap_or_else(|| vec!["winTemp".into(), "userTemp".into(), "recycleBin".into()]);
    // Only allow-listed categories (safety)
    let allowed = [
        "winTemp",
        "userTemp",
        "recycleBin",
        "thumbCache",
        "deliveryOpt",
    ];
    let filtered: Vec<String> = cats
        .into_iter()
        .filter(|c| allowed.contains(&c.as_str()))
        .collect();
    let mut preview = serde_json::Map::new();
    for cat in filtered.iter() {
        let ps = match cat.as_str() {
            "winTemp" => {
                r#"Get-ChildItem -Path $env:WINDIR\Temp -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select Count,Sum | ConvertTo-Json -Compress"#
            }
            "userTemp" => {
                r#"Get-ChildItem -Path $env:TEMP -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select Count,Sum | ConvertTo-Json -Compress"#
            }
            "recycleBin" => {
                r#"$errs=@(); $files=@(); foreach ($d in [System.IO.DriveInfo]::GetDrives()) { if ($d.DriveType -ne 'Fixed' -or -not $d.IsReady) { continue }; $bin = $d.Name + '$Recycle.Bin'; if (-not (Test-Path -LiteralPath $bin)) { continue }; $e=$null; $files += @(Get-ChildItem -LiteralPath $bin -Recurse -Force -File -ErrorAction SilentlyContinue -ErrorVariable e); if ($e) { $errs += $e } }; if ($errs.Count -gt 0) { 'null' } else { $files | Measure-Object -Property Length -Sum | Select Count,Sum | ConvertTo-Json -Compress }"#
            }
            "thumbCache" => {
                r#"Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\thumbcache*.db" -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select Count,Sum | ConvertTo-Json -Compress"#
            }
            "deliveryOpt" => {
                r#"Get-ChildItem -Path "$env:WINDIR\ServiceProfiles\NetworkService\AppData\Local\DeliveryOptimization" -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select Count,Sum | ConvertTo-Json -Compress"#
            }
            _ => "null",
        };
        let out = run_powershell(ps).unwrap_or_else(|_| "null".to_string());
        let v: serde_json::Value = serde_json::from_str(&out).unwrap_or(serde_json::Value::Null);
        preview.insert(cat.clone(), v);
    }
    Ok(
        serde_json::json!({ "preview": preview, "allowed": allowed, "mode": "preview-only read-only" }),
    )
}

// 6. forecast — From free-space history, estimate days until full (read-only calc)
#[tauri::command]
fn forecast(
    drive_id: String,
    history: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    // Linear regression placeholder — real calc is in JS, here we just echo
    let conn = get_db().unwrap_or_else(|_| Connection::open_in_memory().unwrap());
    let _ = init_db(&conn);
    // Try to read last 30 snapshots for this drive
    let mut stmt = conn
        .prepare("SELECT data FROM smart_snapshots WHERE drive_id=? ORDER BY ts DESC LIMIT 30")
        .unwrap_or_else(|_| conn.prepare("SELECT 1").unwrap());
    let _ = stmt;
    Ok(serde_json::json!({
        "drive_id": drive_id,
        "history": history.unwrap_or(serde_json::Value::Null),
        "days_until_full": serde_json::Value::Null,
        "note": "requires 7 days history; insufficient data → unavailable"
    }))
}

// 7. alerts — Temperature, wear, free-space thresholds with 24h debounce (read-only)
#[tauri::command]
fn alerts(thresholds: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    let conn = get_db().ok();
    if let Some(c) = conn {
        let _ = init_db(&c);
    }
    Ok(serde_json::json!({
        "thresholds": thresholds.unwrap_or(serde_json::json!({"tempWarning":50,"tempCritical":60,"wearWarning":70,"freeSpaceWarning":10})),
        "alerts": [],
        "debounce_hours": 24,
        "mode": "read-only"
    }))
}

// 8. db — SQLite tables: drives, smart_snapshots, scans, cleanup_actions, settings, alert_log (read/write persisted)
#[tauri::command]
fn db(action: String, payload: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    let conn = get_db()?;
    init_db(&conn).map_err(|e| e.to_string())?;
    match action.as_str() {
        "get" => {
            let key = payload
                .as_ref()
                .and_then(|v| v.get("key"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let mut stmt = conn
                .prepare("SELECT value FROM settings WHERE key=?")
                .map_err(|e| e.to_string())?;
            let mut rows = stmt.query([key]).map_err(|e| e.to_string())?;
            if let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let val: String = row.get(0).map_err(|e| e.to_string())?;
                Ok(serde_json::json!({ "key": key, "value": val }))
            } else {
                Ok(serde_json::json!({ "key": key, "value": serde_json::Value::Null }))
            }
        }
        "set" => {
            let key = payload
                .as_ref()
                .and_then(|v| v.get("key"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let value = payload
                .as_ref()
                .and_then(|v| v.get("value"))
                .cloned()
                .unwrap_or(serde_json::Value::Null)
                .to_string();
            conn.execute(
                "INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)",
                [&key, &value],
            )
            .map_err(|e| e.to_string())?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "list_scans" => {
            let mut stmt = conn
                .prepare("SELECT data FROM scans ORDER BY ts DESC LIMIT 50")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    let s: String = row.get(0)?;
                    Ok(s)
                })
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for r in rows {
                if let Ok(s) = r {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                        out.push(v);
                    }
                }
            }
            Ok(serde_json::json!({ "scans": out }))
        }
        _ => Ok(
            serde_json::json!({ "tables": ["drives","smart_snapshots","scans","cleanup_actions","settings","alert_log"] }),
        ),
    }
}

// 9. scheduler — Background scheduled scans (read-only status, daily default)
#[tauri::command]
fn scheduler(action: Option<String>) -> Result<serde_json::Value, String> {
    let act = action.unwrap_or_else(|| "status".to_string());
    let conn = get_db().ok();
    let settings: serde_json::Value = if let Some(c) = conn {
        let _ = init_db(&c);
        let mut stmt = c
            .prepare("SELECT value FROM settings WHERE key='settings'")
            .ok();
        if let Some(s) = stmt.as_mut() {
            if let Ok(mut rows) = s.query([]) {
                if let Ok(Some(row)) = rows.next() {
                    if let Ok(val) = row.get::<_, String>(0) {
                        serde_json::from_str(&val).unwrap_or(serde_json::json!({}))
                    } else {
                        serde_json::json!({})
                    }
                } else {
                    serde_json::json!({})
                }
            } else {
                serde_json::json!({})
            }
        } else {
            serde_json::json!({})
        }
    } else {
        serde_json::json!({})
    };
    Ok(serde_json::json!({
        "action": act,
        "schedule": settings.get("schedule").cloned().unwrap_or(serde_json::json!("daily")),
        "next_run": serde_json::Value::Null,
        "mode": "read-only"
    }))
}

#[cfg(test)]
mod drive_tests {
    use super::*;

    #[test]
    fn maps_each_volume_to_its_own_disk_without_guessing() {
        let json = r#"[
            {"letter":"c","total":1000,"free":400,"removable":false,"disk":{"model":"Samsung 980","serial":" S6C2 ","media":"SSD","bus":"NVMe","health":"Healthy","temp":41,"wear":7,"hours":812}},
            {"letter":"D","total":4000,"free":10,"removable":false,"disk":{"model":"WD Blue","serial":"","media":"HDD","bus":"SATA","health":"Healthy","temp":0,"wear":null,"hours":null}},
            {"letter":"E","total":8,"free":4,"removable":true,"disk":null},
            {"letter":"F","total":8,"free":4,"removable":true,"disk":{"model":"Stick","serial":"x","media":"Unspecified","bus":"USB","health":"Healthy"}}
        ]"#;
        let drives = parse_drive_rows(json).unwrap();
        assert_eq!(drives.len(), 4);
        assert_eq!(drives[0].letter.as_deref(), Some("C:"));
        assert_eq!(drives[0].drive_type, "NVMe");
        assert_eq!(drives[0].serial, "S6C2");
        assert_eq!(drives[0].temperature, Some(41));
        assert_eq!(drives[0].wear_percent, Some(7));
        assert_eq!(drives[1].drive_type, "HDD");
        assert_eq!(drives[1].serial, "unavailable");
        assert_eq!(drives[1].temperature, None);
        assert_eq!(drives[1].wear_percent, None);
        assert_eq!(drives[2].model, "Unknown model");
        assert_eq!(drives[2].drive_type, "Unknown");
        assert_eq!(drives[3].drive_type, "USB");
        assert_eq!(drives[2].capacity_bytes, Some(8));
    }

    #[test]
    fn accepts_single_object_empty_and_bom_output() {
        assert_eq!(parse_drive_rows("\u{feff}{\"letter\":\"C\",\"total\":1,\"free\":1}").unwrap().len(), 1);
        assert!(parse_drive_rows("[]").unwrap().is_empty());
        assert!(parse_drive_rows("not json").is_err());
    }
}

#[cfg(test)]
mod scanner_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "drivesage-scan-test-{}-{stamp}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn scan(
        root: &Path,
        max_depth: u8,
        file_cap: u32,
        exclusions: Vec<String>,
    ) -> Result<serde_json::Value, String> {
        scan_paths(
            vec![root.to_path_buf()],
            max_depth,
            file_cap,
            exclusions,
            ScannerState::default(),
            Arc::new(AtomicBool::new(false)),
        )
    }

    #[test]
    fn scanner_respects_depth_and_exclusions_and_hashes_duplicate_contents() {
        let temp = TestDirectory::new();
        let root = &temp.0;
        let nested = root.join("nested");
        let excluded = root.join("excluded");
        let system = root.join("Windows");
        fs::create_dir_all(nested.join("deeper")).unwrap();
        fs::create_dir_all(&excluded).unwrap();
        fs::create_dir_all(&system).unwrap();

        fs::write(root.join("root.bin"), b"root").unwrap();
        let first = vec![b'a'; 8192];
        let mut different = vec![b'a'; 4096];
        different.extend(vec![b'b'; 4096]);
        fs::write(nested.join("copy-a.bin"), &first).unwrap();
        fs::write(nested.join("copy-b.bin"), &first).unwrap();
        fs::write(nested.join("same-size-different-content.bin"), &different).unwrap();
        fs::write(nested.join("deeper").join("ignored.bin"), b"deeper").unwrap();
        fs::write(excluded.join("ignored.bin"), b"excluded").unwrap();
        fs::write(system.join("ignored.bin"), b"system").unwrap();

        let result = scan(root, 1, 100, vec![excluded.to_string_lossy().to_string()]).unwrap();
        assert_eq!(result["file_count"], 4);
        assert_eq!(result["total_bytes"], 4 + 3 * 8192);
        assert_eq!(result["duplicate_groups"].as_array().unwrap().len(), 1);
        assert_eq!(result["duplicate_groups"][0].as_array().unwrap().len(), 2);
        assert_eq!(result["reclaimable_bytes"], 8192);
        assert_eq!(result["capped"], false);
    }

    #[test]
    fn scanner_stops_at_the_file_count_cap() {
        let temp = TestDirectory::new();
        fs::write(temp.0.join("one.bin"), b"one").unwrap();
        fs::write(temp.0.join("two.bin"), b"two").unwrap();
        fs::write(temp.0.join("three.bin"), b"three").unwrap();

        let result = scan(&temp.0, 4, 2, Vec::new()).unwrap();
        assert_eq!(result["file_count"], 2);
        assert_eq!(result["capped"], true);
    }

    #[test]
    fn scanner_cancellation_keeps_a_partial_result_from_being_returned() {
        let temp = TestDirectory::new();
        fs::write(temp.0.join("file.bin"), b"content").unwrap();
        let cancelled = Arc::new(AtomicBool::new(true));
        let result = scan_paths(
            vec![temp.0.clone()],
            4,
            10,
            Vec::new(),
            ScannerState::default(),
            cancelled,
        );
        assert_eq!(result.unwrap_err(), "Scan stopped.");
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ScannerState::default())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            drives,
            smart,
            scanner,
            scanner_progress,
            stop_scanner,
            cleanup,
            forecast,
            alerts,
            db,
            scheduler
        ])
        .run(tauri::generate_context!())
        .expect("error while running DriveSage");
}
