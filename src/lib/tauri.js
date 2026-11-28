// Tauri bridge for read-only drive data and native local-file scanning.
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

   // Not running inside the desktop app (or detection failed): caller shows labelled demo data.
   return null
 }

 export async function getSmart(driveId){
   let d = await invokeTauri('smart', {driveId})
   if (d) return d
   d = await invokeTauri('get_smart', {driveId})
   if(d) return d
   return null
 }

 export async function scanStorage(maxDepth, fileCap, excludedPaths=[]){
   return invokeTauri('scanner', {maxDepth, fileCap, excludedPaths})
 }

 export async function findDuplicates(maxDepth, fileCap, excludedPaths=[]){
   const result = await scanStorage(maxDepth, fileCap, excludedPaths)
   return result ? {groups:result.duplicate_groups, reclaimable:result.reclaimable_bytes} : null
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
