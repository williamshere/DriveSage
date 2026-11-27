import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import Sidebar from './components/Sidebar.jsx'
import Dashboard from './pages/Dashboard.jsx'
import DriveDetail from './pages/DriveDetail.jsx'
import StorageMap from './pages/StorageMap.jsx'
import Duplicates from './pages/Duplicates.jsx'
import Cleanup from './pages/Cleanup.jsx'
import History from './pages/History.jsx'
import Settings from './pages/Settings.jsx'
import { mockDrives, mockHistory, formatBytes } from './lib/drives.js'
import { CLEANUP_CATEGORIES } from './lib/cleanup.js'
import { getDB, setDB, addScan } from './lib/db.js'
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
  const [tree,setTree]=useState(()=>({name:'This PC',path:'',size:0,file_count:0,children:[]}))
  const [dupes,setDupes]=useState({groups:[],reclaimable:0})
  const [largest,setLargest]=useState([])
  const [fileCount,setFileCount]=useState(0)
  const [hasScanned,setHasScanned]=useState(false)
  const [scanError,setScanError]=useState('')
  const [previewError,setPreviewError]=useState('')
  const [previewing,setPreviewing]=useState(false)
  const [enabledIds,setEnabledIds]=useState(()=> settings.enabledCategories || DEFAULT_SETTINGS.enabledCategories)
  const [deletionMode,setDeletionMode]=useState('recycle')
  const [preview,setPreview]=useState(null)
  const [scanning,setScanning]=useState(false)
  const [progress,setProgress]=useState({pct:0, phase:'idle'})
  const scanInProgress=useRef(false)
  const stopRequested=useRef(false)
  const [scanCount,setScanCount]=useState(()=>{
    try{ return (JSON.parse(localStorage.getItem('drivesage:db:v1')||'{}').scans||[]).length }catch{return 0}
  })
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
          // No snapshots are stored yet, so charts and forecast stay empty rather than showing invented data.
          setHistories(norm.map(d=>({driveId:d.id,temps:[],frees:[]})))
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

  const handleSelectDrive = useCallback((id) => {
    setSelectedId(id)
    setPage('drive')
  }, [])

  const runScan=async()=>{
    if(scanInProgress.current) return
    if(!window.__TAURI__?.core?.invoke){
      setScanError('File scanning is available in the DriveSage desktop app, not in a browser preview.')
      return
    }
    scanInProgress.current=true
    stopRequested.current=false
    setScanError('')
    setScanning(true)
    setProgress({pct:0,phase:'Preparing local drives',filesScanned:0,bytesScanned:0})
    const progressTimer=window.setInterval(async()=>{
      try{
        const current=await window.__TAURI__.core.invoke('scanner_progress')
        setProgress({
          pct:0,
          phase:current.current_root ? `${current.phase} — ${current.current_root}` : current.phase,
          filesScanned:current.files_scanned,
          bytesScanned:current.bytes_scanned,
        })
      }catch(error){
        setScanError(`Could not read scan progress: ${error instanceof Error ? error.message : String(error)}`)
      }
    },350)
    try{
      const result=await window.__TAURI__.core.invoke('scanner',{
        maxDepth:settings.maxDepth,
        fileCap:settings.fileCountCap,
        excludedPaths:settings.excludedPaths||[],
      })
      setTree(result.tree)
      setDupes({groups:result.duplicate_groups||[],reclaimable:result.reclaimable_bytes||0})
      setLargest(result.largest_files||[])
      setFileCount(result.file_count||0)
      setHasScanned(true)
      const entry={
        ts:Date.now(),
        driveId:'all',
        fileCount:result.file_count||0,
        bytes:result.total_bytes||0,
        capped:!!result.capped,
      }
      addScan(entry); setScans(getDB().scans); setScanCount(getDB().scans.length)
      setProgress({
        pct:100,
        phase:result.capped ? 'Scan limit reached' : 'Scan complete',
        filesScanned:result.file_count||0,
        bytesScanned:result.total_bytes||0,
      })
      const notices=[]
      if(result.capped) notices.push(`Reached the ${(result.file_cap||settings.fileCountCap).toLocaleString()} file limit; results are partial. Increase the cap in Settings to scan more.`)
      if(result.unreadable_paths>0) notices.push(`${result.unreadable_paths.toLocaleString()} file or folder entries could not be read; accessible files are included.`)
      setScanError(notices.join(' '))
    }catch(error){
      if(stopRequested.current){
        setProgress(current=>({...current,phase:'Scan stopped — previous results kept'}))
      }else{
        setScanError(error instanceof Error ? error.message : String(error))
        setProgress(current=>({...current,phase:'Scan failed'}))
      }
    }finally{
      window.clearInterval(progressTimer)
      scanInProgress.current=false
      stopRequested.current=false
      setScanning(false)
    }
  }
  const stopScan=async()=>{
    if(!scanInProgress.current) return
    if(!window.__TAURI__?.core?.invoke){
      setScanError('Could not stop the scan because the desktop scanner is unavailable.')
      return
    }
    stopRequested.current=true
    setProgress(current=>({...current,phase:'Stopping scan…'}))
    try{
      await window.__TAURI__.core.invoke('stop_scanner')
    }catch(error){
      stopRequested.current=false
      setScanError(`Could not stop scan: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handlePreview=async()=>{
    setPreviewError('')
    if(!window.__TAURI__?.core?.invoke){
      setPreview(null)
      setPreviewError('Cleanup preview measures real files and is only available in the DriveSage desktop app.')
      return
    }
    setPreviewing(true)
    try{
      const result=await window.__TAURI__.core.invoke('cleanup',{categories:enabledIds})
      const items=CLEANUP_CATEGORIES.filter(cat=>enabledIds.includes(cat.id)).map(cat=>{
        const m=result.preview?.[cat.id]
        return { category:cat, count:Number(m?.Count)||0, bytes:Number(m?.Sum)||0, measured:!!m }
      })
      setPreview({ items, totalCount:items.reduce((a,i)=>a+i.count,0), totalBytes:items.reduce((a,i)=>a+i.bytes,0) })
    }catch(error){
      setPreview(null)
      setPreviewError(error instanceof Error ? error.message : String(error))
    }finally{
      setPreviewing(false)
    }
  }

  const handleExportJson=()=>{
    const blob=new Blob([JSON.stringify(getDB(), null, 2)], {type:'application/json'})
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`drivesage-export-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="shell">
      <Sidebar page={page} setPage={setPage} theme={theme} setTheme={setTheme} settings={settings} scanCount={scanCount} />
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
        {page==='dashboard' && <Dashboard drives={drives} histories={histories} settings={settings} onSelectDrive={handleSelectDrive} onScan={runScan} scanning={scanning} onStopScan={stopScan} progress={progress} scanError={scanError} />}
        {page==='drive' && <DriveDetail drive={selectedDrive} history={histories.find(h=>h.driveId===selectedId)} drives={drives} selectedId={selectedId} onSelect={setSelectedId} />}
        {page==='map' && <StorageMap tree={tree} scanning={scanning} progress={progress} onScan={runScan} onStopScan={stopScan} hasScanned={hasScanned} scanError={scanError} />}
        {page==='dupes' && <Duplicates fileCount={fileCount} dupes={dupes} largest={largest} scanning={scanning} progress={progress} onScan={runScan} onStopScan={stopScan} hasScanned={hasScanned} scanError={scanError} />}
        {page==='cleanup' && <Cleanup enabledIds={enabledIds} setEnabledIds={setEnabledIds} deletionMode={deletionMode} setDeletionMode={setDeletionMode} onPreview={handlePreview} preview={preview} previewing={previewing} previewError={previewError} log={cleanupLog} />}
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
