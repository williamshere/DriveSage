import { formatBytes } from '../lib/drives.js'
import { computeHealth, bandColor } from '../lib/health.js'
import { checkAlerts } from '../lib/alerts.js'
import { exportDrivesCsv, copyDriveInfo } from '../lib/export.js'
import { useState } from 'react'

function HealthRing({score,band}){
  const c=bandColor(band)
  return (
    <div className="health-ring" style={{background:`conic-gradient(${c} ${score}%, var(--panel-3) 0)`}}>
      <div style={{width:72,height:72,borderRadius:'50%',background:'var(--panel)',display:'grid',placeItems:'center',border:'1px solid var(--border)'}}>
        <div style={{textAlign:'center'}}>
          <b style={{color:c}}>{score}</b><br/><em>{band}</em>
        </div>
      </div>
    </div>
  )
}
function DriveCard({drive, history, onClick}){
  const hs = computeHealth({
    wearPercent: drive.wearPercent ?? 0,
    tempHistory: history?.temps || [],
    maxTemp: drive.temperature ?? 0,
    warningTemp: 50,
    reallocated: drive.reallocated ?? 0,
    pending: drive.pending ?? 0,
    crcErrors: drive.crcErrors ?? 0,
  })
  const pct = drive.capacityBytes ? Math.round((1 - drive.freeBytes/drive.capacityBytes)*100) : 0
  const [copied,setCopied]=useState(false)
  const handleCopy=(e)=>{
    e.stopPropagation()
    copyDriveInfo(drive)
    setCopied(true)
    setTimeout(()=>setCopied(false), 1200)
  }
  const handleOpen=(e)=>{
    e.stopPropagation()
    // Tauri shell open or fallback to showing path
    if(window.__TAURI__ && window.__TAURI__.shell){
      window.__TAURI__.shell.open(drive.letter + '\\')
    } else if(window.__TAURI__ && window.__TAURI__.core){
      window.__TAURI__.core.invoke('scanner', {path: drive.letter + '\\'}).catch(()=>{})
      // also try to open via shell plugin if available
      try{ window.__TAURI__.core.invoke('open_path', {path: drive.letter + '\\'}) }catch{}
    } else {
      alert(`Drive path: ${drive.letter}\\ \nModel: ${drive.model}\nSerial: ${drive.serial}\nCapacity: ${formatBytes(drive.capacityBytes)}\nFree: ${formatBytes(drive.freeBytes)}\n\nTip: in Tauri desktop app this opens File Explorer (read-only).`)
    }
  }
  return (
    <div className="card drive-card" onClick={onClick} style={{position:'relative'}}>
      <div className="drive-top">
        <div style={{minWidth:0}}>
          <div className="drive-letter">{drive.letter} <span style={{fontSize:11,color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',marginLeft:6}}>{drive.type}</span></div>
          <div className="drive-model" title={drive.model}>{drive.model}</div>
          <div className="drive-meta mono">{drive.serial} • {formatBytes(drive.capacityBytes)} • {drive.powerOnHours? `${drive.powerOnHours.toLocaleString()} hrs` : 'hours unavailable'}</div>
        </div>
        <HealthRing score={hs.score} band={hs.band}/>
      </div>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--muted)',marginBottom:6}}>
          <span className="mono">{formatBytes(drive.capacityBytes - drive.freeBytes)} used</span><span className="mono">{formatBytes(drive.freeBytes)} free</span>
        </div>
        <div className={`bar ${pct>85?'warn':''}`}><i style={{width:`${pct}%`}}/></div>
        <div style={{display:'flex',justifyContent:'space-between',marginTop:6,fontSize:11,color:'var(--muted)'}}>
          <span>{pct}% occupied</span><span className="mono" title="Read-only via Get-StorageReliabilityCounter / MSStorageDriver; unavailable when non-admin or unsupported">{drive.temperature!=null? `${drive.temperature}°C` : 'temp unavailable'}</span>
        </div>
      </div>
      <div className="breakdown">
        <span>Lifespan <strong>{hs.breakdown.lifespan}</strong></span>
        <span>Temp <strong>{hs.breakdown.temperature}</strong></span>
        <span>Errors <strong>{hs.breakdown.errors}</strong></span>
      </div>
      <div style={{display:'flex',gap:6,alignItems:'center', flexWrap:'wrap'}}>
        <span className={`badge ${hs.band==='Healthy'?'badge-healthy':hs.band==='Watch'?'badge-watch':'badge-risk'}`}>{hs.band}</span>
        {drive.wearPercent!=null && <span className="pill mono">wear {drive.wearPercent}%</span>}
        {drive.wearPercent==null && <span className="pill mono" title="Wear requires SMART read-only access">wear unavailable</span>}
        {drive.reallocated>0 && <span className="pill" style={{color:'var(--red)'}}>reallocated {drive.reallocated}</span>}
      </div>
      <div style={{display:'flex', gap:6, marginTop:10}}>
        <button className="btn btn-sm" onClick={handleCopy} title="Copy drive info to clipboard">{copied?'Copied!':'Copy info'}</button>
        <button className="btn btn-sm" onClick={handleOpen} title="Open drive in File Explorer (read-only)">Open</button>
      </div>
    </div>
  )
}

export default function Dashboard({ drives, histories, settings, onSelectDrive, onScan, scanning, onStopScan, progress }){
  const alerts=[]
  for(const d of drives){
    const hs=checkAlerts(d, { tempWarning: settings.tempWarning, tempCritical: settings.tempCritical, wearWarning: settings.wearWarning, freeSpaceWarningPct: settings.freeSpaceWarning }, Date.now())
    for(const a of hs) alerts.push({...a, driveId:d.id})
  }
  const totalBytes = drives.reduce((a,b)=>a+(b.capacityBytes||0),0)
  const freeBytes = drives.reduce((a,b)=>a+(b.freeBytes||0),0)
  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Dashboard <small className="mono">{drives.length} drives • {formatBytes(totalBytes)} total • {formatBytes(freeBytes)} free</small></h1>
        <div className="top-actions" style={{display:'flex', gap:8}}>
          <button className="btn" onClick={()=>exportDrivesCsv(drives)} title="Export real drive list as CSV (read-only)">Export CSV</button>
          {!scanning ? <button className="btn btn-primary" onClick={onScan}>Scan now</button> : <button className="btn" onClick={onStopScan}>Stop scan</button>}
        </div>
      </div>

      <div className="card" style={{padding:'12px 14px', marginBottom:12, display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', fontSize:12}}>
        <span style={{fontWeight:700}}>Diagnostics:</span>
        <span className="mono" style={{color:'var(--muted)'}}>{drives.length} real drives • WMI Get-PhysicalDisk/Get-StorageReliabilityCounter read-only • SMART “unavailable” when non-admin or unsupported (never writes firmware/clocks/RAID)</span>
        <span className="pill mono" style={{marginLeft:'auto'}}>Read-only • No network • No telemetry</span>
      </div>

      {scanning && (
        <div className="card" style={{padding:14,marginBottom:14,display:'flex',alignItems:'center',gap:14}}>
          <div style={{flex:1}}>
            <div style={{fontSize:12,fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--muted)'}}>Scanning — {progress.phase}</div>
            <div className="bar" style={{marginTop:8}}><i style={{width:`${progress.pct}%`}}/></div>
          </div>
          <div className="mono" style={{fontSize:12,color:'var(--muted)'}}>{progress.pct}%</div>
        </div>
      )}

      {alerts.length>0 && (
        <div className={`alert-banner ${alerts.some(a=>a.level==='critical')?'critical':''}`}>
          <span style={{fontSize:18}}>{alerts.some(a=>a.level==='critical')?'▲':'●'}</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:13}}>System alerts — {alerts.length}</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{alerts.map(a=>a.msg).join(' • ')}</div>
          </div>
        </div>
      )}

      <div className="grid grid-3">
        {drives.map(d=> <DriveCard key={d.id} drive={d} history={histories.find(h=>h.driveId===d.id)} onClick={()=>onSelectDrive(d.id)} />)}
      </div>

      <div className="grid grid-3" style={{marginTop:14}}>
        <div className="card"><div className="card-head"><div className="card-title">Health overview</div></div>
          <div className="card-body">
            {drives.map(d=>{
              const hs=computeHealth({wearPercent:d.wearPercent??0, maxTemp:d.temperature??0, tempHistory:histories.find(h=>h.driveId===d.id)?.temps||[], reallocated:d.reallocated??0, pending:d.pending??0, crcErrors:d.crcErrors??0})
              return <div key={d.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                <span className="mono" style={{fontSize:13}}>{d.letter} {d.model.split(' ').slice(0,2).join(' ')}</span>
                <span style={{display:'flex',gap:8,alignItems:'center'}}><span className="mono" style={{fontWeight:800}}>{hs.score}</span><span className={`badge ${hs.band==='Healthy'?'badge-healthy':hs.band==='Watch'?'badge-watch':'badge-risk'}`} style={{fontSize:10}}>{hs.band}</span></span>
              </div>
            })}
            <div style={{marginTop:10, fontSize:11, color:'var(--muted)'}}>40% lifespan • 30% temperature • 30% errors — breakdown per drive</div>
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Capacity at a glance</div><span className="card-sub mono">largest bar = most full</span></div>
          <div className="card-body">
            {[...drives].sort((a,b)=> (b.capacityBytes-b.freeBytes)/b.capacityBytes - (a.capacityBytes-a.freeBytes)/a.capacityBytes).map(d=>{
              const pct=Math.round((1-d.freeBytes/d.capacityBytes)*100)
              return <div key={d.id} style={{marginBottom:12}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><b>{d.letter}</b><span className="mono">{pct}%</span></div>
                <div className={`bar ${pct>85?'warn':''}`} style={{marginTop:6}}><i style={{width:`${pct}%`}}/></div>
              </div>
            })}
            <button className="btn btn-sm" style={{marginTop:8}} onClick={()=>exportDrivesCsv(drives)}>Download CSV report</button>
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Safety & Real Data</div></div>
          <div className="card-body" style={{fontSize:13,lineHeight:1.6,color:'var(--muted)'}}>
            <div style={{color:'var(--text)',fontWeight:700}}>Read-only hardware access</div>
            SMART + capacity via Windows APIs only (<code>Get-PhysicalDisk</code>, <code>Get-StorageReliabilityCounter</code>, MSStorageDriver). No writes to firmware, clocks or RAID.<br/>
            <div style={{color:'var(--text)',fontWeight:700,marginTop:10}}>Real drives on this machine</div>
            {drives.map(d=> <div key={d.id} className="mono" style={{fontSize:11, marginTop:4}}>{d.letter} {d.model} — {formatBytes(d.capacityBytes)} free {formatBytes(d.freeBytes)} {d.temperature!=null? `• ${d.temperature}°C` : '• temp unavailable'}</div>)}
            <div style={{color:'var(--text)',fontWeight:700,marginTop:10}}>Deletions go to Recycle Bin</div>
            Permanent delete only on explicit choice per run. Every action logged. <code>unavailable</code> shown for any unreadable attribute.
          </div>
        </div>
      </div>
    </div>
  )
}
