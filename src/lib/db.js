// Simple IndexedDB/localStorage wrapper that mimics SQLite tables spec
// Tables: drives, smart_snapshots, scans, cleanup_actions, settings, alert_log
const LS_KEY='drivesage:db:v1'
function load(){
  try{ const raw=localStorage.getItem(LS_KEY); if(raw) return JSON.parse(raw)}catch{}
  return { drives:[], smart_snapshots:[], scans:[], cleanup_actions:[], settings:{}, alert_log:{} }
}
function save(db){ try{ localStorage.setItem(LS_KEY, JSON.stringify(db)) }catch{} }

export function getDB(){ return load() }
export function setDB(db){ save(db) }
export function upsertDrive(drive){
  const db=load(); const i=db.drives.findIndex(d=>d.id===drive.id)
  if(i>=0) db.drives[i]={...db.drives[i],...drive, updatedAt:Date.now()}
  else db.drives.push({...drive, createdAt:Date.now()})
  save(db); return db
}
export function addSnapshot(snap){ const db=load(); db.smart_snapshots.push({...snap, ts:Date.now()}); save(db); prune(db); return db }
export function addScan(scan){ const db=load(); db.scans.push({...scan, ts:Date.now()}); save(db); return db }
export function addCleanup(action){ const db=load(); db.cleanup_actions.push({...action, ts:Date.now()}); save(db); return db }
export function getSettings(){ const db=load(); return db.settings }
export function setSetting(k,v){ const db=load(); db.settings[k]=v; save(db); return db }
export function prune(db){
  const retention = db.settings.retentionDays ?? 90
  const cutoff = Date.now() - retention*86400000
  db.smart_snapshots = db.smart_snapshots.filter(s=>s.ts > cutoff)
}
export function exportReport(db){
  return JSON.stringify(db, null, 2)
}
