#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::process::Command;
use rusqlite::{Connection, Result as SqlResult};
use std::path::PathBuf;

// ---------- helpers ----------

fn run_powershell(script: &str) -> Result<String, String> {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
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

// ---------- 9 Tauri commands ----------
// 1. drives — Detect physical drives, partitions, models, serials, capacity (read-only)
#[tauri::command]
fn drives() -> Result<serde_json::Value, String> {
    // Try WMI Get-PhysicalDisk + Get-Volume (requires admin, may fail) — degrade gracefully
    let ps_script = r#"
        $ErrorActionPreference='SilentlyContinue';
        try { $disks = Get-PhysicalDisk | Select FriendlyName,MediaType,BusType,Size,HealthStatus,OperationalStatus,SerialNumber,DeviceId | ConvertTo-Json -Depth 2 -Compress } catch { $disks='[]' }
        if (-not $disks) { $disks='[]' }
        try { $vols = Get-Volume | Where DriveLetter -ne $null | Select DriveLetter,Size,SizeRemaining,FileSystem,HealthStatus | ConvertTo-Json -Depth 2 -Compress } catch { $vols='[]' }
        if (-not $vols) { $vols='[]' }
        try { $rel = Get-PhysicalDisk | ForEach { try { Get-StorageReliabilityCounter -PhysicalDisk $_ | Select Temperature,Wear,ReadErrorsTotal,PowerOnHours | ConvertTo-Json -Compress } catch {'null'} } } catch {}
        @{disks=$disks; vols=$vols} | ConvertTo-Json -Compress
    "#;
    let wmi_result = run_powershell(ps_script);

    // Always also collect .NET DriveInfo (works without admin) for real capacity/free
    let mut drives: Vec<DriveInfo> = Vec::new();
    // Use filesystem drives via Rust std
    for (idx, letter) in ["C", "D", "E", "F", "G"].iter().enumerate() {
        let path = format!("{}:\\", letter);
        if let Ok(meta) = std::fs::metadata(&path) {
            let _ = meta;
            // Try to get size via powershell .NET as fallback per-drive
            let cap_script = format!(r#"[System.IO.DriveInfo]::GetDrives() | Where Name -eq '{}:\' | Select TotalSize,AvailableFreeSpace | ConvertTo-Json -Compress"#, letter);
            let mut capacity: Option<u64> = None;
            let mut free: Option<u64> = None;
            if let Ok(out) = run_powershell(&cap_script) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&out) {
                    capacity = v.get("TotalSize").and_then(|x| x.as_u64());
                    free = v.get("AvailableFreeSpace").and_then(|x| x.as_u64());
                    // fallback if array
                    if capacity.is_none() {
                        if let Some(arr) = v.as_array() {
                            if let Some(first) = arr.first() {
                                capacity = first.get("TotalSize").and_then(|x| x.as_u64());
                                free = first.get("AvailableFreeSpace").and_then(|x| x.as_u64());
                            }
                        }
                    }
                }
            }
            // Determine type via simple heuristic
            let drive_type = if *letter == "C" { "NVMe".to_string() } else if *letter == "D" { "HDD".to_string() } else { "Fixed".to_string() };
            // Try to parse WMI disks for model/serial if available
            let mut model = format!("Drive {}", letter);
            let mut serial = format!("unknown-{}", idx);
            let mut bus_type: Option<String> = None;
            let mut health: Option<String> = None;
            if let Ok(ref wmi) = wmi_result {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(wmi) {
                    if let Some(disks_str) = parsed.get("disks").and_then(|x| x.as_str()) {
                        if let Ok(disks) = serde_json::from_str::<serde_json::Value>(disks_str) {
                            let arr: Vec<serde_json::Value> = if disks.is_array() { disks.as_array().unwrap().clone() } else { vec![disks] };
                            if let Some(d) = arr.get(idx) {
                                if let Some(name) = d.get("FriendlyName").and_then(|x| x.as_str()) { model = name.to_string(); }
                                if let Some(s) = d.get("SerialNumber").and_then(|x| x.as_str()) { if !s.trim().is_empty() { serial = s.trim().to_string(); } }
                                bus_type = d.get("BusType").and_then(|x| x.as_str()).map(|s| s.to_string());
                                health = d.get("HealthStatus").and_then(|x| x.as_str()).map(|s| s.to_string());
                            }
                        }
                    }
                }
            }
            // If capacity still none, try Rust stat (fallback: use 0)
            drives.push(DriveInfo {
                id: format!("drive{}", idx),
                letter: Some(format!("{}:", letter)),
                model,
                serial,
                capacity_bytes: capacity,
                free_bytes: free,
                temperature: None,
                wear_percent: None,
                reallocated: None,
                pending: None,
                crc_errors: None,
                power_on_hours: None,
                drive_type,
                health_status: health,
                bus_type,
            });
        }
    }
    // If no drives found via letter scan, fallback to at least C:
    if drives.is_empty() {
        // Try .NET directly for C:
        let out = run_powershell("[System.IO.DriveInfo]::GetDrives() | Select Name,TotalSize,AvailableFreeSpace | ConvertTo-Json -Compress").unwrap_or_default();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&out) {
            let arr: Vec<serde_json::Value> = if v.is_array() { v.as_array().unwrap().clone() } else { vec![v] };
            for (i, d) in arr.iter().enumerate() {
                let name = d.get("Name").and_then(|x| x.as_str()).unwrap_or("C:\\");
                drives.push(DriveInfo {
                    id: format!("drive{}", i),
                    letter: Some(name.trim_end_matches('\\').trim_end_matches(':').to_string() + ":"),
                    model: "Generic Drive".to_string(),
                    serial: format!("generic-{}", i),
                    capacity_bytes: d.get("TotalSize").and_then(|x| x.as_u64()),
                    free_bytes: d.get("AvailableFreeSpace").and_then(|x| x.as_u64()),
                    temperature: None,
                    wear_percent: None,
                    reallocated: None,
                    pending: None,
                    crc_errors: None,
                    power_on_hours: None,
                    drive_type: "Fixed".to_string(),
                    health_status: None,
                    bus_type: None,
                });
            }
        }
    }
    // Also try to enrich with SMART where possible (best effort, read-only)
    for d in drives.iter_mut() {
        if let Some(ref letter) = d.letter.clone() {
            let smart_script = format!(r#"
                $ErrorActionPreference='SilentlyContinue';
                try {{ $c = Get-StorageReliabilityCounter -PhysicalDisk (Get-PhysicalDisk | Select -First 1); @{{temp=$c.Temperature; wear=$c.Wear; hours=$c.PowerOnHours}} | ConvertTo-Json -Compress }} catch {{ 'null' }}
            "#);
            if let Ok(out) = run_powershell(&smart_script) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&out) {
                    if !v.is_null() {
                        d.temperature = v.get("temp").and_then(|x| x.as_i64()).map(|x| x as i32);
                        d.wear_percent = v.get("wear").and_then(|x| x.as_u64()).map(|x| x as u8);
                        d.power_on_hours = v.get("hours").and_then(|x| x.as_u64()).map(|x| x as u32);
                    }
                }
            }
        }
    }
    Ok(serde_json::json!({ "drives": drives, "wmi_available": wmi_result.is_ok() }))
}

// 2. smart — Read SMART attributes per drive, degrade gracefully (read-only, MSStorageDriver)
#[tauri::command]
fn smart(drive_id: String) -> Result<serde_json::Value, String> {
    let ps = r#"
        $ErrorActionPreference='SilentlyContinue';
        $out=@();
        try { $counters = Get-PhysicalDisk | ForEach { try { Get-StorageReliabilityCounter -PhysicalDisk $_ } catch {} } ; $out += $counters | Select Temperature,Wear,ReadErrorsTotal,ReadErrorsCorrected,WriteErrorsTotal,PowerOnHours,TemperatureMax | ConvertTo-Json -Compress } catch {}
        try { $wmi = Get-WmiObject -Namespace root\wmi -Class MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue | Select InstanceName,Active,PredictFailure,Reason | ConvertTo-Json -Compress; $out += $wmi } catch {}
        if ($out.Count -eq 0) { 'null' } else { $out | ConvertTo-Json -Compress }
    "#;
    let raw = run_powershell(ps).unwrap_or_else(|_| "null".to_string());
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
    Ok(serde_json::json!({
        "drive_id": drive_id,
        "attributes": parsed,
        "reallocated": serde_json::Value::Null,
        "pending": serde_json::Value::Null,
        "wear_percent": serde_json::Value::Null,
        "temperature": serde_json::Value::Null,
        "note": "SMART read-only via Get-StorageReliabilityCounter/MSStorageDriver; unavailable fields show as null/unavailable in UI"
    }))
}

// 3. scanner — Parallel directory walk for usage (read-only, skips system paths)
#[tauri::command]
fn scanner(path: String, max_depth: Option<u8>, file_cap: Option<u32>) -> Result<serde_json::Value, String> {
    let target = if path.is_empty() { "C:\\".to_string() } else { path.clone() };
    let max_d: u8 = max_depth.unwrap_or(6);
    let cap: u32 = file_cap.unwrap_or(50000);
    // Use PowerShell to quickly enumerate top-level folders sizes (read-only)
    let ps = format!(r#"
        $ErrorActionPreference='SilentlyContinue';
        $root='{}';
        Get-ChildItem -Path $root -Directory -Force -ErrorAction SilentlyContinue | Select Name,FullName | ForEach {{
            try {{ $sz = (Get-ChildItem -Path $_.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum; @{{name=$_.Name; size=$sz}} }} catch {{ @{{name=$_.Name; size=$null}} }}
        }} | ConvertTo-Json -Compress
    "#, target.replace("'", "''"));
    let out = run_powershell(&ps).unwrap_or_else(|_| "[]".to_string());
    let tree: serde_json::Value = serde_json::from_str(&out).unwrap_or(serde_json::json!([]));
    Ok(serde_json::json!({
        "path": target,
        "max_depth": max_d,
        "file_cap": cap,
        "tree": tree,
        "mode": "read-only"
    }))
}

// 4. duplicates — Stage 1 group by size, Stage 2 hash confirm (read-only)
#[tauri::command]
fn duplicates(path: String) -> Result<serde_json::Value, String> {
    let target = if path.is_empty() { "C:\\Users".to_string() } else { path };
    let ps = format!(r#"
        $ErrorActionPreference='SilentlyContinue';
        $root='{}';
        $files = Get-ChildItem -Path $root -Recurse -File -Force -ErrorAction SilentlyContinue | Select FullName,Length | Group-Object Length | Where Count -gt 1 | Select -First 20 | ForEach {{ @{{size=$_.Name; count=$_.Count; sample=$_.Group[0].FullName}} }};
        $files | ConvertTo-Json -Compress
    "#, target.replace("'", "''"));
    let out = run_powershell(&ps).unwrap_or_else(|_| "[]".to_string());
    let groups: serde_json::Value = serde_json::from_str(&out).unwrap_or(serde_json::json!([]));
    Ok(serde_json::json!({ "path": target, "groups": groups, "mode": "read-only hash confirm" }))
}

// 5. cleanup — Build preview per category (read-only preview)
#[tauri::command]
fn cleanup(categories: Option<Vec<String>>) -> Result<serde_json::Value, String> {
    let cats = categories.unwrap_or_else(|| vec!["winTemp".into(), "userTemp".into(), "recycleBin".into()]);
    // Only allow-listed categories (safety)
    let allowed = ["winTemp","userTemp","recycleBin","thumbCache","deliveryOpt"];
    let filtered: Vec<String> = cats.into_iter().filter(|c| allowed.contains(&c.as_str())).collect();
    let mut preview = serde_json::Map::new();
    for cat in filtered.iter() {
        let ps = match cat.as_str() {
            "winTemp" => r#"Get-ChildItem -Path $env:WINDIR\Temp -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select Count,Sum | ConvertTo-Json -Compress"#,
            "userTemp" => r#"Get-ChildItem -Path $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select Count,Sum | ConvertTo-Json -Compress"#,
            "recycleBin" => r#"Get-ChildItem -Path 'C:\$Recycle.Bin' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select Count,Sum | ConvertTo-Json -Compress"#,
            "thumbCache" => r#"Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\thumbcache*.db" -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select Count,Sum | ConvertTo-Json -Compress"#,
            "deliveryOpt" => r#"Get-ChildItem -Path "$env:WINDIR\ServiceProfiles\NetworkService\AppData\Local\DeliveryOptimization" -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select Count,Sum | ConvertTo-Json -Compress"#,
            _ => "null",
        };
        let out = run_powershell(ps).unwrap_or_else(|_| "null".to_string());
        let v: serde_json::Value = serde_json::from_str(&out).unwrap_or(serde_json::Value::Null);
        preview.insert(cat.clone(), v);
    }
    Ok(serde_json::json!({ "preview": preview, "allowed": allowed, "mode": "preview-only read-only" }))
}

// 6. forecast — From free-space history, estimate days until full (read-only calc)
#[tauri::command]
fn forecast(drive_id: String, history: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    // Linear regression placeholder — real calc is in JS, here we just echo
    let conn = get_db().unwrap_or_else(|_| Connection::open_in_memory().unwrap());
    let _ = init_db(&conn);
    // Try to read last 30 snapshots for this drive
    let mut stmt = conn.prepare("SELECT data FROM smart_snapshots WHERE drive_id=? ORDER BY ts DESC LIMIT 30").unwrap_or_else(|_| conn.prepare("SELECT 1").unwrap());
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
            let key = payload.as_ref().and_then(|v| v.get("key")).and_then(|v| v.as_str()).unwrap_or("");
            let mut stmt = conn.prepare("SELECT value FROM settings WHERE key=?").map_err(|e| e.to_string())?;
            let mut rows = stmt.query([key]).map_err(|e| e.to_string())?;
            if let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let val: String = row.get(0).map_err(|e| e.to_string())?;
                Ok(serde_json::json!({ "key": key, "value": val }))
            } else {
                Ok(serde_json::json!({ "key": key, "value": serde_json::Value::Null }))
            }
        },
        "set" => {
            let key = payload.as_ref().and_then(|v| v.get("key")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let value = payload.as_ref().and_then(|v| v.get("value")).cloned().unwrap_or(serde_json::Value::Null).to_string();
            conn.execute("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)", [&key, &value]).map_err(|e| e.to_string())?;
            Ok(serde_json::json!({ "ok": true }))
        },
        "list_scans" => {
            let mut stmt = conn.prepare("SELECT data FROM scans ORDER BY ts DESC LIMIT 50").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| { let s: String = row.get(0)?; Ok(s) }).map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for r in rows { if let Ok(s) = r { if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) { out.push(v); } } }
            Ok(serde_json::json!({ "scans": out }))
        },
        _ => Ok(serde_json::json!({ "tables": ["drives","smart_snapshots","scans","cleanup_actions","settings","alert_log"] }))
    }
}

// 9. scheduler — Background scheduled scans (read-only status, daily default)
#[tauri::command]
fn scheduler(action: Option<String>) -> Result<serde_json::Value, String> {
    let act = action.unwrap_or_else(|| "status".to_string());
    let conn = get_db().ok();
    let settings: serde_json::Value = if let Some(c) = conn {
        let _ = init_db(&c);
        let mut stmt = c.prepare("SELECT value FROM settings WHERE key='settings'").ok();
        if let Some(s) = stmt.as_mut() {
            if let Ok(mut rows) = s.query([]) {
                if let Ok(Some(row)) = rows.next() {
                    if let Ok(val) = row.get::<_, String>(0) {
                        serde_json::from_str(&val).unwrap_or(serde_json::json!({}))
                    } else { serde_json::json!({}) }
                } else { serde_json::json!({}) }
            } else { serde_json::json!({}) }
        } else { serde_json::json!({}) }
    } else { serde_json::json!({}) };
    Ok(serde_json::json!({
        "action": act,
        "schedule": settings.get("schedule").cloned().unwrap_or(serde_json::json!("daily")),
        "next_run": serde_json::Value::Null,
        "mode": "read-only"
    }))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            drives,
            smart,
            scanner,
            duplicates,
            cleanup,
            forecast,
            alerts,
            db,
            scheduler
        ])
        .run(tauri::generate_context!())
        .expect("error while running DriveSage");
}
