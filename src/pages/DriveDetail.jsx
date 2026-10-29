import { formatBytes, formatTemp } from '../lib/drives.js'
import { computeHealth, bandColor } from '../lib/health.js'
import { estimateDaysUntilFull, formatForecast } from '../lib/forecast.js'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts'

export default function DriveDetail({ drive, history, drives, selectedId, onSelect }){
  if(!drive) return <div className="card" style={{padding:40,textAlign:'center',color:'var(--muted)'}}>Select a drive to inspect.</div>
  const hs = computeHealth({ wearPercent: drive.wearPercent??0, maxTemp: drive.temperature??0, tempHistory: history?.temps||[], reallocated: drive.reallocated??0, pending: drive.pending??0, crcErrors: drive.crcErrors??0 })
  const forecast = estimateDaysUntilFull(history?.frees || [])
  const tempData = (history?.temps||[]).map((t,i)=>({ day:`D${i+1}`, temp:t }))
  const freeData = (history?.frees||[]).map((f,i)=>({ day:`D${i+1}`, free: Math.round(f.freeBytes/1024/1024/1024) }))

  const smartRows=[
    { name:'Reallocated sectors', value: drive.reallocated, ok: (drive.reallocated??0)===0 },
    { name:'Pending sectors', value: drive.pending, ok: (drive.pending??0)===0 },
    { name:'CRC errors', value: drive.crcErrors, ok: (drive.crcErrors??0)===0 },
    { name:'Power-on hours', value: drive.powerOnHours, ok:true, fmt: v=> v?.toLocaleString() },
    { name:'Wear percentage', value: drive.wearPercent, ok: (drive.wearPercent??0) < 20, fmt: v=> v!=null? `${v}%`: '—' },
    { name:'Temperature', value: drive.temperature, ok: (drive.temperature??0) < 50, fmt: v=> formatTemp(v) },
  ]

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Drive detail <small className="mono">{drive.letter} — {drive.model}</small></h1>
        <select className="select" style={{width:260}} value={selectedId} onChange={e=>onSelect(e.target.value)}>
          {drives.map(d=> <option key={d.id} value={d.id}>{d.letter} {d.model}</option>)}
        </select>
      </div>

      <div className="grid grid-3">
        <div className="card" style={{padding:18,display:'flex',gap:16,alignItems:'center'}}>
          <div style={{width:96,height:96,borderRadius:'50%',background:`conic-gradient(${bandColor(hs.band)} ${hs.score}%, var(--panel-3) 0)`,display:'grid',placeItems:'center'}}>
            <div style={{width:78,height:78,borderRadius:'50%',background:'var(--panel)',display:'grid',placeItems:'center',border:'1px solid var(--border)'}}>
              <div style={{textAlign:'center'}}><div style={{fontSize:26,fontWeight:800,color:bandColor(hs.band)}}>{hs.score}</div><div style={{fontSize:10,letterSpacing:'.08em',textTransform:'uppercase',color:'var(--muted)'}}>{hs.band}</div></div>
            </div>
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800}}>Health score</div>
            <div className="breakdown" style={{marginTop:8}}>
              <span>Lifespan <strong>{hs.breakdown.lifespan}</strong></span>
              <span>Temp <strong>{hs.breakdown.temperature}</strong></span>
              <span>Errors <strong>{hs.breakdown.errors}</strong></span>
            </div>
            <div style={{fontSize:11,color:'var(--muted)',marginTop:8}}>40% lifespan • 30% temperature • 30% errors. 80+ Healthy, 50–79 Watch, &lt;50 At risk.</div>
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Capacity</div></div>
          <div className="card-body">
            <div className="stat">{formatBytes(drive.freeBytes)} <small>free of {formatBytes(drive.capacityBytes)}</small></div>
            <div className="bar" style={{marginTop:12}}><i style={{width:`${Math.round((1-drive.freeBytes/drive.capacityBytes)*100)}%`}}/></div>
            <div className="mono" style={{fontSize:11,color:'var(--muted)',marginTop:8}}>{drive.letter} • {drive.type} • {drive.serial}</div>
            <div style={{marginTop:10,fontSize:12,padding:'8px 10px',borderRadius:8,background:'var(--panel-2)',border:'1px solid var(--border)'}}>{formatForecast(forecast)}</div>
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Identity</div></div>
          <div className="card-body mono" style={{fontSize:12,lineHeight:1.9}}>
            <div><span style={{color:'var(--muted)'}}>Model</span> {drive.model}</div>
            <div><span style={{color:'var(--muted)'}}>Serial</span> {drive.serial}</div>
            <div><span style={{color:'var(--muted)'}}>Type</span> {drive.type}</div>
            <div><span style={{color:'var(--muted)'}}>Letter</span> {drive.letter}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{marginTop:14}}>
        <div className="card"><div className="card-head"><div className="card-title">SMART attributes</div><span className="card-sub">read-only • unavailable = null</span></div>
          <div className="card-body" style={{padding:0}}>
            <table className="table">
              <thead><tr><th>Attribute</th><th>Value</th><th>Status</th></tr></thead>
              <tbody>
                {smartRows.map(r=>(
                  <tr key={r.name}>
                    <td style={{fontWeight:600}}>{r.name}</td>
                    <td className="mono">{r.value==null? 'unavailable' : (r.fmt? r.fmt(r.value) : r.value)}</td>
                    <td>{r.value==null? <span className="pill">unknown</span> : r.ok? <span className="badge badge-healthy" style={{fontSize:11}}>OK</span> : <span className="badge badge-risk" style={{fontSize:11}}>Attention</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Temperature history</div><span className="card-sub mono">14 days • warning 50°C / critical 60°C</span></div>
          <div className="card-body" style={{height:240}}>
            {tempData.length? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={tempData}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/><XAxis dataKey="day" tick={{fontSize:11, fill:'var(--muted)'}}/><YAxis tick={{fontSize:11, fill:'var(--muted)'}} domain={[20,70]}/><Tooltip contentStyle={{background:'var(--panel-2)',border:'1px solid var(--border)',borderRadius:8}}/><Line type="monotone" dataKey="temp" stroke="#e8a317" strokeWidth={2} dot={false}/></LineChart>
              </ResponsiveContainer>
            ): <div style={{color:'var(--muted)',fontSize:13}}>No temperature history yet.</div>}
          </div>
        </div>
      </div>

      <div className="card" style={{marginTop:14}}>
        <div className="card-head"><div className="card-title">Free space history</div><span className="card-sub mono">GB free • forecast needs 7 days</span></div>
        <div className="card-body" style={{height:220}}>
          {freeData.length? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={freeData}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/><XAxis dataKey="day" tick={{fontSize:11, fill:'var(--muted)'}}/><YAxis tick={{fontSize:11, fill:'var(--muted)'}}/><Tooltip contentStyle={{background:'var(--panel-2)',border:'1px solid var(--border)',borderRadius:8}}/><Area type="monotone" dataKey="free" stroke="#2ec5a0" fill="#2ec5a0" fillOpacity={0.14} strokeWidth={2}/></AreaChart>
            </ResponsiveContainer>
          ): <div style={{color:'var(--muted)',fontSize:13}}>No free-space history yet.</div>}
        </div>
        <div style={{padding:'0 16px 14px',fontSize:12,color:'var(--muted)'}}>{formatForecast(forecast)} {forecast.slope!=null && <span className="mono">• slope {forecast.slope.toExponential(2)} B/day</span>}</div>
      </div>
    </div>
  )
}
