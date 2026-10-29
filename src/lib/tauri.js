 // Tauri bridge — real drive data via 9 Rust commands, fallback to real-drives.json / demo
 export async function invokeTauri(cmd, args={}){
   if (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
     try { return await window.__TAURI__.core.invoke(cmd, args) } catch(e){ console.warn(`tauri ${cmd} failed`, e); return null }
   }
   if (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.invoke) {
     try { return await window.__TAURI__.invoke(cmd, args) } catch(e){ return null }
   }
   return null
 }

 export async function getRealDrives(){
   // 1) Tauri Rust (Get-PhysicalDisk + .NET DriveInfo, read-only)
   let data = await invokeTauri('drives')
   if (data && data.drives && data.drives.length) return data.drives
   // also try alternative name
   data = await invokeTauri('get_drives')
   if (data && data.drives && data.drives.length) return data.drives

   // 2) Vite dev server API (if vite.config adds /api/drives)
   try {
     const r = await fetch('/api/drives')
     if (r.ok) {
       const j = await r.json()
       if (j.drives && j.drives.length) return j.drives
     }
   } catch {}

   // 3) Static real-drives.json generated from .NET DriveInfo at build time (this machine: C: 1.79TB, D: 489GB)
   try {
     const r = await fetch('/real-drives.json')
     if (r.ok) {
       const j = await r.json()
       if (Array.isArray(j) && j.length) return j
       if (j.drives && j.drives.length) return j.drives
     }
   } catch {}

   // 4) unavailable — caller shows demo with note
   return null
 }

 export async function getSmart(driveId){
   let d = await invokeTauri('smart', {driveId})
   if (d) return d
   d = await invokeTauri('get_smart', {driveId})
   if(d) return d
   try { const r=await fetch(`/api/smart?drive=${encodeURIComponent(driveId)}`); if(r.ok) return await r.json() } catch {}
   // also try static
   try { const r=await fetch('/real-drives.json'); if(r.ok){ const j=await r.json(); const arr=Array.isArray(j)?j:j.drives||[]; const found=arr.find(x=>x.id===driveId); if(found) return {attributes: found} } } catch {}
   return null
 }

 export async function scanStorage(path, maxDepth, fileCap){
   let d = await invokeTauri('scanner', {path, maxDepth, fileCap})
   if(d) return d
   d = await invokeTauri('scan_storage', {path, maxDepth, fileCap})
   if(d) return d
   try { const r=await fetch(`/api/scanner?path=${encodeURIComponent(path)}`); if(r.ok) return await r.json()} catch {}
   return null
 }

 export async function findDuplicates(path){
   let d = await invokeTauri('duplicates', {path})
   if(d) return d
   d = await invokeTauri('find_duplicates', {path})
   if(d) return d
   try { const r=await fetch(`/api/duplicates?path=${encodeURIComponent(path)}`); if(r.ok) return await r.json()} catch {}
   return null
 }

 export async function previewCleanup(categories){
   let d = await invokeTauri('cleanup', {categories})
   if(d) return d
   d = await invokeTauri('preview_cleanup', {categories})
   if(d) return d
   try { const r=await fetch('/api/cleanup',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({categories})}); if(r.ok) return await r.json()} catch {}
   return null
 }

 export async function getForecast(driveId, history){
   let d = await invokeTauri('forecast', {driveId, history})
   if(d) return d
   d = await invokeTauri('get_forecast', {driveId, history})
   if(d) return d
   return null
 }

 export async function checkAlerts(thresholds){
   let d = await invokeTauri('alerts', {thresholds})
   if(d) return d
   d = await invokeTauri('check_alerts', {thresholds})
   if(d) return d
   return null
 }

 export async function dbAction(action, payload){
   let d = await invokeTauri('db', {action, payload})
   if(d) return d
   d = await invokeTauri('db_query', {action, payload})
   if(d) return d
   return null
 }

 export async function getScheduler(action){
   let d = await invokeTauri('scheduler', {action})
   if(d) return d
   d = await invokeTauri('get_scheduler', {action})
   if(d) return d
   return null
 }
