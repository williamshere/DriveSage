import React, { useEffect, useMemo, useState, useCallback } from 'react'
import Sidebar from './components/Sidebar.jsx'
import Dashboard from './pages/Dashboard.jsx'
import DriveDetail from './pages/DriveDetail.jsx'
import StorageMap from './pages/StorageMap.jsx'
import Duplicates from './pages/Duplicates.jsx'
import Cleanup from './pages/Cleanup.jsx'
import History from './pages/History.jsx'
import Settings from './pages/Settings.jsx'
import { mockDrives, mockFiles, mockFolderTree, mockCleanupFiles, mockHistory, formatBytes } from './lib/drives.js'
import { findDuplicateGroups, largestFiles } from './lib/duplicates.js'
import { buildPreview } from './lib/cleanup.js'
import { getDB, setDB, addScan, addCleanup } from './lib/db.js'
import { getRealDrives } from './lib/tauri.js'

const DEFAULT_SETTINGS={
  schedule:'daily', timeOfDay:'02:00',
  tempWarning:50, tempCritical:60, wearWarning:70, freeSpaceWarning:10,
  excludedPaths:[], enabledCategories:['winTemp','userTemp','recycleBin','thumbCache','deliveryOpt'],
  theme:'dark', autostart:false, retentionDays:90, maxDepth:12, fileCountCap:500000
}

function normalizeDrive(raw){
  // Handle both Rust (snake_case) and JS (camelCase) + unavailable nulls
  return {
    id: raw.id || raw.deviceId || `drive-${raw.letter||'unknown'}`,
    letter: raw.letter || raw.DriveLetter || null,
    model: raw.model || raw.FriendlyName || 'unavailable',
    serial: raw.serial || raw.SerialNumber || 'unavailable',
    capacityBytes: raw.capacityBytes ?? raw.capacity_bytes ?? raw.TotalSize ?? null,
    freeBytes: raw.freeBytes ?? raw.free_bytes ?? raw.AvailableFreeSpace ?? raw.SizeRemaining ?? null,
    temperature: raw.temperature ?? null,
    wearPercent: raw.wearPercent ?? raw.wear_percent ?? raw.Wear ?? null,
    reallocated: raw.reallocated ?? raw.ReadErrorsTotal ?? null,
    pending: raw.pending ?? null,
    crcErrors: raw.crcErrors ?? null,
    powerOnHours: raw.powerOnHours ?? raw.PowerOnHours ?? null,
    type: raw.type || raw.drive_type || raw.MediaType || 'Fixed',
    healthStatus: raw.healthStatus || raw.health_status || null,
    busType: raw.busType || raw.bus_type || null,
  }
}

export default function App(){
  const [page,setPage]=useState('dashboard')
  const [theme,setTheme]=useState(()=> {
    try{ return JSON.parse(localStorage.getItem('drivesage:db:v1')||'{}')?.settings?.theme || 'dark' }catch{return 'dark'}
  })
  const [settings,setSettings]=useState(()=>{
    try{ const db=JSON.parse(localStorage.getItem('drivesage:db:v1')||'{}'); return {...DEFAULT_SETTINGS, ...(db.settings||{})} }catch{ return DEFAULT_SETTINGS }
  })
  const [drives,setDrives]=useState(()=> mockDrives())
  const [drivesSource,setDrivesSource]=useState('demo')
  const [histories,setHistories]=useState(()=> mockHistory(mockDrives()))
  const [selectedId,setSelectedId]=useState(()=> mockDrives()[0].id)
  const selectedDrive = useMemo(()=> drives.find(d=>d.id===selectedId)||drives[0], [drives, selectedId])
  const [tree,setTree]=useState(()=> mockFolderTree())
  const [files]=useState(()=> mockFiles())
  const [cleanupFiles]=useState(()=> mockCleanupFiles())
  const [enabledIds,setEnabledIds]=useState(()=> settings.enabledCategories || DEFAULT_SETTINGS.enabledCategories)
  const [deletionMode,setDeletionMode]=useState('recycle')
  const [preview,setPreview]=useState(null)
  const [scanning,setScanning]=useState(false)
  const [progress,setProgress]=useState({pct:0, phase:'idle'})
  const [scanCount,setScanCount]=useState(()=>{
    try{ return (JSON.parse(localStorage.getItem('drivesage:db:v1')||'{}').scans||[]).length }catch{return 0}
  })
  const [executing,setExecuting]=useState(false)
  const [cleanupLog,setCleanupLog]=useState(()=>{
    try{ return JSON.parse(localStorage.getItem('drivesage:db:v1')||'{}').cleanup_actions||[] }catch{return []}
  })
  const [scans,setScans]=useState(()=>{
    try{ return JSON.parse(localStorage.getItem('drivesage:db:v1')||'{}').scans||[] }catch{return []}
  })

  // --- REAL DRIVE DATA: replace demo with Tauri / Vite / .NET real drives ---
  useEffect(()=>{
    let cancelled=false
    getRealDrives().then(real=>{
      if(cancelled) return
      if(real && real.length){
        const norm = real.map(normalizeDrive).filter(d=> d.capacityBytes && d.capacityBytes>0)
        if(norm.length){
          setDrives(norm)
          setHistories(mockHistory(norm))
          setSelectedId(norm[0].id)
          setDrivesSource('real')
          // Also store snapshot for health/forecast
          try{
            const db=getDB()
            db.lastRealDrives = {ts: Date.now(), drives: norm}
            setDB(db)
          }catch{}
        }
      } else {
        setDrivesSource('demo (real unavailable - showing demo; SMART requires Tauri + admin)')
      }
    }).catch(()=>{})
    return ()=>{ cancelled=true }
  },[])

  useEffect(()=>{ document.documentElement.className = theme==='light' ? 'light' : '' }, [theme])
  useEffect(()=>{
    const db = getDB(); db.settings = {...settings, theme, enabledCategories: enabledIds}; setDB(db)
  }, [settings, theme, enabledIds])

  const dupes = useMemo(()=> findDuplicateGroups(files), [files])
  const largest = useMemo(()=> largestFiles(files, 20), [files])

  const handleSelectDrive = useCallback((id) => {
    setSelectedId(id)
    setPage('drive')
  }, [])

  const runScan = (phase='Scanning disk…')=>{
    if(scanning) return
    setScanning(true); setProgress({pct:6, phase})
    let pct=6
    const phases=['Reading partitions','Walking folders','Hashing candidates','Finalizing']
    let pi=0
    const id=setInterval(()=>{
      pct = Math.min(96, pct + Math.random()*14+4)
      if(pct>30 && pi===0){ pi=1; setProgress({pct:Math.round(pct), phase:phases[1]})}
      else if(pct>60 && pi===1){ pi=2; setProgress({pct:Math.round(pct), phase:phases[2]})}
      else if(pct>85 && pi===2){ pi=3; setProgress({pct:Math.round(pct), phase:phases[3]})}
      else setProgress(s=>({...s, pct:Math.round(pct)}))
      if(pct>=96){
        clearInterval(id)
        setTimeout(()=>{
          setScanning(false); setProgress({pct:100, phase:'Done'})
          const entry={ ts:Date.now(), driveId:'all', fileCount: files.length, bytes: files.reduce((a,b)=>a+b.size,0)}
          addScan(entry); setScans(getDB().scans); setScanCount(getDB().scans.length)
          setTree(t=>({...t}))
        }, 420)
      }
    }, 260)
    window.__driveSageInterval=id
  }
  const stopScan=()=>{
    clearInterval(window.__driveSageInterval)
    setScanning(false); setProgress({pct:0, phase:'Stopped — disk untouched'})
    setTimeout(()=> setProgress({pct:0, phase:'idle'}), 1600)
  }

  const handlePreview=()=>{
    const p=buildPreview(cleanupFiles, enabledIds)
    setPreview(p)
  }
  const handleExecute=()=>{
    if(!preview || preview.totalCount===0) return
    setExecuting(true)
    let pct=0
    const intv=setInterval(()=>{
      pct+= Math.random()*22+8
      if(pct>=100){
        clearInterval(intv)
        const entry={ ts:Date.now(), mode: deletionMode, count: preview.totalCount, bytes: preview.totalBytes, files: preview.items.flatMap(it=>it.files).slice(0,20) }
        addCleanup(entry); setCleanupLog(getDB().cleanup_actions)
        setExecuting(false); setPreview(null)
      }
    }, 220)
  }

  const handleExportJson=()=>{
    const blob=new Blob([JSON.stringify(getDB(), null, 2)], {type:'application/json'})
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`drivesage-export-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="shell">
      <Sidebar page={page} setPage={setPage} theme={theme} setTheme={setTheme} settings={settings} scanInfo={{scans: scanCount}} />
      <main className="main">
        {drivesSource!=='real' && (
          <div className="card" style={{padding:'10px 14px', marginBottom:12, background:'var(--panel-2)', border:'1px dashed var(--border)', fontSize:12, color:'var(--muted)'}}>
            <b style={{color:'var(--text)'}}>Data source:</b> {drivesSource} — <span>SMART/temperature/wear show &quot;unavailable&quot; when non-admin or when drive does not expose the attribute (read-only, never writes firmware)</span>
            {drivesSource.startsWith('real') && <span style={{marginLeft:8, color:'var(--accent)'}}>● {drives.length} real drives detected ({drives.map(d=>`${d.letter} ${formatBytes(d.capacityBytes)}`).join(' • ')})</span>}
          </div>
        )}
        {drivesSource==='real' && (
          <div className="card" style={{padding:'8px 14px', marginBottom:12, background:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.25)', fontSize:12}}>
            <span style={{color:'var(--accent)', fontWeight:700}}>● Real drives connected</span> <span className="mono" style={{color:'var(--muted)', marginLeft:8}}>{drives.map(d=>`${d.letter} ${d.model} ${formatBytes(d.capacityBytes)} free ${formatBytes(d.freeBytes)}`).join(' • ')}</span>
          </div>
        )}
        {page==='dashboard' && <Dashboard drives={drives} histories={histories} settings={settings} onSelectDrive={handleSelectDrive} onScan={()=>runScan('Scanning all drives…')} scanning={scanning} onStopScan={stopScan} progress={progress} />}
        {page==='drive' && <DriveDetail drive={selectedDrive} history={histories.find(h=>h.driveId===selectedId)} drives={drives} selectedId={selectedId} onSelect={setSelectedId} />}
        {page==='map' && <StorageMap tree={tree} scanning={scanning} progress={progress} onScan={()=>runScan('Building storage map…')} onStopScan={stopScan} />}
        {page==='dupes' && <Duplicates files={files} dupes={dupes} largest={largest} scanning={scanning} progress={progress} onScan={()=>runScan('Finding duplicates…')} onStopScan={stopScan} />}
        {page==='cleanup' && <Cleanup cleanupFiles={cleanupFiles} enabledIds={enabledIds} setEnabledIds={setEnabledIds} deletionMode={deletionMode} setDeletionMode={setDeletionMode} onPreview={handlePreview} preview={preview} onExecute={handleExecute} executing={executing} log={cleanupLog} />}
        {page==='history' && <History scans={scans} cleanups={cleanupLog} onExport={handleExportJson} />}
        {page==='settings' && <Settings settings={{...settings, theme, enabledCategories: enabledIds}} setSettings={(updater)=>{
          const next = typeof updater==='function' ? updater({...settings, theme, enabledCategories: enabledIds}) : updater
          if(next.theme) setTheme(next.theme)
          if(next.enabledCategories) setEnabledIds(next.enabledCategories)
          setSettings({...settings, ...next})
        }} />}
      </main>
    </div>
  )
}
