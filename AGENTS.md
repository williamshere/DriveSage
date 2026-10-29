# DriveSage — Storage Health & Cleanup Studio
## Custom build instructions for Muse Code CLI

Build DriveSage as a premium, local-first Windows desktop app. It is a
sibling to SentinelAI, SysAudit, and CertiGPU: real measurements, a health
score, a report, and controls that respect the hardware. Nothing ever leaves
the machine. There is no cloud account, no analytics, and no network calls.

## Stack

- Frontend: Tauri v2 + React 18 + Vite, Recharts for charts.
- Backend: Rust (Tauri commands). SQLite via rusqlite for all history.
- Drive data: Windows APIs only — PowerShell/WMI
  (`Get-PhysicalDisk`, `Get-StorageReliabilityCounter`, MSStorageDriver) for
  detection and SMART. Reads are read-only, always.
- Packaging: `tauri build` to a single Windows `.exe` with an app icon.
- Tests: Rust unit tests for the scoring, forecast, duplicate-detection, and
  cleanup-preview logic. No placeholder or TODO code in any shipped path.

## Screens (sidebar layout, dark theme default, light theme toggle)

1. **Dashboard** — Every drive as a card (model, capacity, free space bar,
   temperature, health score). System-wide alerts banner. "Scan now" button.
2. **Drive detail** — Click a drive: SMART attributes table (reallocated
   sectors, power-on hours, wear percentage, temperature), temperature and
   free-space history charts, lifespan projection.
3. **Storage map** — Treemap of disk usage by folder, largest first.
   Click a block to drill in. Excludes system paths by default.
4. **Duplicates & large files** — Duplicate groups (same size, then hash
   confirmed) with total reclaimable space, and a largest-files list.
5. **Cleanup** — Preview screen first: categories with checkboxes, exact
   file count and bytes per category. Execute only after the user confirms.
   Every action is logged and reversible where possible (see Safety rules).
6. **History** — Past scans, past cleanups, and exported reports.
7. **Settings** — Everything below, persisted and applied without restart.

## Health score (0–100, per drive)

- 40% remaining lifespan (wear percentage / SMART wear indicators).
- 30% temperature behavior (time spent above warning threshold).
- 30% error indicators (reallocated sectors, pending sectors, CRC errors).
- Score bands: 80+ Healthy, 50–79 Watch, below 50 At risk. Show the
  breakdown, never just the number.

## Backend modules

- `drives` — Detect physical drives, partitions, models, serials, capacity.
- `smart` — Read SMART attributes per drive, degrade gracefully when a
  drive or attribute is unavailable (show "unavailable", never crash).
- `scanner` — Parallel directory walk for usage and duplicates. Skip
  system paths, hidden OS folders, and user exclusions. Respect a
  configurable max depth and file-count cap.
- `duplicates` — Stage 1: group by size. Stage 2: confirm with a fast hash
  of the first block, then a full hash only for survivors.
- `cleanup` — Build a preview (file list, count, bytes) per category,
  execute the user's selection, log every deletion to SQLite.
- `forecast` — From free-space history, estimate days until the drive is
  full (linear trend). Show "insufficient history" until 7 days of data.
- `alerts` — Temperature, wear, and free-space thresholds with a
  24-hour debounce per drive per alert type.
- `db` — SQLite tables: drives, smart_snapshots, scans, cleanup_actions,
  settings (key/value), alert_log.
- `scheduler` — Background scheduled scans (daily default, configurable).

## Settings (all user-changeable, all persisted)

- Scan schedule: daily/weekly/manual, time of day.
- Thresholds: temperature warning/critical, wear warning, free-space warning %.
- Excluded paths list (add/remove).
- Cleanup categories on/off: Windows Temp, user Temp, Recycle Bin,
  thumbnail cache, delivery-optimization files. Nothing else is cleanable.
- Deletion mode: Recycle Bin (default) or permanent (explicit choice only).
- Theme: dark/light. Autostart: launch minimized to tray on login.
- Data retention: snapshot history in days (default 90, auto-pruned).

## Safety rules (hard rules, never break these)

1. Never delete anything without the user confirming on the preview
   screen, with exact file count and bytes shown.
2. Deletions go to the Recycle Bin by default. Permanent delete only when
   the user explicitly picks it for that run.
3. Never touch `C:\Windows`, `Program Files`, or the user's Documents,
   Pictures, Desktop, or Downloads unless the user explicitly adds a path.
4. Cleanup only touches the allow-listed categories in Settings.
5. SMART and drive reads are read-only. Never write drive settings or
   firmware, never change clocks, voltages, or RAID configuration.
6. Every scan and cleanup runs with a progress indicator and a Stop
   button. Stopping mid-run leaves the disk untouched by that run.
7. All destructive actions are logged to SQLite with a timestamp and the
   full file list, so the user can see exactly what happened.

## Build order (work milestone by milestone, in this order)

- **M1 — Scaffold + detection.** Tauri + React shell, sidebar layout,
  Settings page shell, drive detection, Dashboard drive cards.
- **M2 — SMART + health.** SMART reader, health score + bands, drive
  detail page, history charts, SQLite snapshots.
- **M3 — Storage map + duplicates.** Usage scanner, treemap, duplicate
  finder, largest-files list.
- **M4 — Cleanup.** Preview screen, execute with Recycle Bin default,
  action log, undo guidance, safety rules enforced and tested.
- **M5 — Forecast, alerts, schedule, package.** Forecast engine, alert
  thresholds + debounce, scheduled scans, autostart, HTML report export,
  `tauri build` producing a working `.exe`, app icon.

## Working rules for the agent

- Finish one milestone completely before starting the next. After each
  milestone, build the app and run the test suite. Do not proceed with
  failing tests or a failing build — fix them first.
- Keep all state local (SQLite + a settings file next to the app data).
  No network calls, no accounts, no telemetry.
- Degrade gracefully everywhere: a missing drive, a denied path, or an
  unreadable SMART attribute shows "unavailable" in the UI, never a crash.
- When the whole Definition of Done below is met, write a file named
  `BUILD_COMPLETE.md` in the project root listing what was built, how to
  run it, how to build the `.exe`, and the final test results.

## Definition of Done (all must be true before stopping)

- [ ] App launches on Windows and lists every physical drive correctly.
- [ ] Each drive shows a health score with its visible breakdown.
- [ ] SMART history charts render from real SQLite snapshots.
- [ ] Storage map, duplicates, and largest-files all work on a real disk.
- [ ] Cleanup preview shows exact counts and bytes; confirmed cleanup
      deletes only the selected items and logs them.
- [ ] Forecast shows days-until-full, or "insufficient history".
- [ ] Scheduled scans, alerts, theme toggle, and all Settings persist.
- [ ] Test suite passes and `tauri build` produces a working `.exe`.
