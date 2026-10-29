import { formatBytes } from '../lib/drives.js'

export default function History({ scans, cleanups, onExport }){
  const exportHtml=()=>{
    const html=`<!doctype html><meta charset="utf-8"><title>DriveSage Report — ${new Date().toLocaleString()}</title><style>body{font-family:system-ui;padding:32px;max-width:900px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5}</style><h1>DriveSage — Storage Report</h1><p>Generated ${new Date().toLocaleString()}</p><h2>Scans (${scans.length})</h2><table><tr><th>When</th><th>Drive</th><th>Files</th><th>Bytes</th></tr>${scans.map(s=>`<tr><td>${new Date(s.ts).toLocaleString()}</td><td>${s.driveId||'all'}</td><td>${s.fileCount??'—'}</td><td>${s.bytes??'—'}</td></tr>`).join('')||`<tr><td colspan=4>No scans yet</td></tr>`}</table><h2>Cleanups (${cleanups.length})</h2><table><tr><th>When</th><th>Mode</th><th>Count</th><th>Bytes</th></tr>${cleanups.map(c=>`<tr><td>${new Date(c.ts).toLocaleString()}</td><td>${c.mode}</td><td>${c.count}</td><td>${c.bytes}</td></tr>`).join('')||`<tr><td colspan=4>No cleanups yet</td></tr>`}</table><p style="color:#666;margin-top:24px">Local report — no data left this machine.</p>`
    const blob=new Blob([html],{type:'text/html'})
    const url=URL.createObjectURL(blob)
    const a=document.createElement('a'); a.href=url; a.download=`drivesage-report-${new Date().toISOString().slice(0,10)}.html`; a.click(); URL.revokeObjectURL(url)
  }
  return (
    <div>
      <div className="topbar">
        <h1 className="h1">History <small className="mono">{scans.length} scans • {cleanups.length} cleanups</small></h1>
        <div className="top-actions">
          <button className="btn" onClick={exportHtml}>Export HTML report</button>
          <button className="btn btn-ghost" onClick={onExport}>Export JSON</button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div className="card-title">Past scans</div></div>
          <div className="card-body" style={{padding:0}}>
            {scans.length===0? <div style={{padding:20,color:'var(--muted)',fontSize:13}}>No scans yet. Run a scan from Dashboard.</div> : (
              <table className="table">
                <thead><tr><th>When</th><th>Files</th><th>Bytes</th></tr></thead>
                <tbody>
                  {[...scans].reverse().map((s,i)=>(
                    <tr key={i}><td className="mono" style={{fontSize:12}}>{new Date(s.ts).toLocaleString()}</td><td className="mono">{s.fileCount?.toLocaleString() ?? '—'}</td><td className="mono">{s.bytes!=null? formatBytes(s.bytes): '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Past cleanups</div><span className="card-sub">every action logged</span></div>
          <div className="card-body" style={{padding:0}}>
            {cleanups.length===0? <div style={{padding:20,color:'var(--muted)',fontSize:13}}>No cleanups yet.</div> : (
              <table className="table">
                <thead><tr><th>When</th><th>Mode</th><th>Files</th><th>Bytes</th></tr></thead>
                <tbody>
                  {[...cleanups].reverse().map((c,i)=>(
                    <tr key={i}><td className="mono" style={{fontSize:12}}>{new Date(c.ts).toLocaleString()}</td><td><span className={`pill ${c.mode==='permanent'?'':''}`} style={c.mode==='permanent'?{color:'var(--red)'}:{}}>{c.mode}</span></td><td className="mono">{c.count}</td><td className="mono">{formatBytes(c.bytes)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      <div className="card" style={{marginTop:14,padding:14}}>
        <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.6}}>
          All history is stored locally in browser storage (IndexedDB/localStorage) mirroring the SQLite spec. No network calls. Retention is configurable in Settings (default 90 days, auto-pruned).
        </div>
      </div>
    </div>
  )
}
