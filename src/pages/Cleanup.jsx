import { formatBytes } from '../lib/drives.js'
import { CLEANUP_CATEGORIES, buildPreview } from '../lib/cleanup.js'

export default function Cleanup({ cleanupFiles, enabledIds, setEnabledIds, deletionMode, setDeletionMode, onPreview, preview, onExecute, executing, log }){
  const toggle=(id)=>{
    setEnabledIds(ids=> ids.includes(id)? ids.filter(x=>x!==id) : [...ids, id])
  }
  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Cleanup <small style={{color:'var(--amber)',fontWeight:700}}>Preview first — nothing deleted until you confirm</small></h1>
        <div className="top-actions">
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'var(--muted)'}}>
            <select className="select" value={deletionMode} onChange={e=>setDeletionMode(e.target.value)} style={{width:160}}>
              <option value="recycle">Recycle Bin (default)</option>
              <option value="permanent">Permanent delete</option>
            </select>
          </label>
        </div>
      </div>

      <div className="alert-banner">
        <span>⚠</span>
        <div style={{fontSize:12,lineHeight:1.5}}>
          <b>Safety rules:</b> Only allow-listed categories are cleanable. Protected paths (<span className="mono">C:\Windows, Program Files, Documents/Pictures/Desktop/Downloads</span>) are never touched unless you explicitly add them in Settings. Every deletion is logged with file list and timestamp.
        </div>
      </div>

      <div className="grid" style={{gridTemplateColumns:'300px 1fr', gap:14}}>
        <div className="card">
          <div className="card-head"><div className="card-title">Categories</div><span className="card-sub">allow-list only</span></div>
          <div className="card-body" style={{display:'flex',flexDirection:'column',gap:10}}>
            {CLEANUP_CATEGORIES.map(cat=>{
              const files=cleanupFiles[cat.id]||[]
              const bytes=files.reduce((a,b)=>a+b.size,0)
              const on=enabledIds.includes(cat.id)
              return (
                <label key={cat.id} style={{display:'flex',gap:10,alignItems:'flex-start',padding:'10px',borderRadius:10,border:`1px solid ${on?'#2a6b5a':'var(--border)'}`,background: on? 'var(--teal-dim)':'var(--panel-2)',cursor:'pointer'}}>
                  <input type="checkbox" className="check" checked={on} onChange={()=>toggle(cat.id)} />
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:13}}>{cat.label}</div>
                    <div style={{fontSize:11,color:'var(--muted)'}}>{cat.desc}</div>
                    <div className="mono" style={{fontSize:11,color:'var(--muted)',marginTop:4}}>{files.length} files • {formatBytes(bytes)}</div>
                  </div>
                </label>
              )
            })}
            <button className="btn btn-primary" onClick={onPreview} disabled={executing || enabledIds.length===0}>Build preview</button>
            {deletionMode==='permanent' && <div style={{fontSize:11,color:'var(--red)',fontWeight:700}}>Permanent delete will bypass Recycle Bin for this run.</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Preview</div><span className="card-sub mono">{preview? `${preview.totalCount} files • ${formatBytes(preview.totalBytes)}` : 'no preview yet'}</span></div>
          <div className="card-body" style={{padding:0}}>
            {!preview? <div style={{padding:24,color:'var(--muted)',fontSize:13}}>Select categories and build a preview. Exact file count and bytes are shown before any delete. <br/>Execution requires confirmation.</div> : (
              <>
                <table className="table">
                  <thead><tr><th>Category</th><th>Count</th><th>Bytes</th></tr></thead>
                  <tbody>
                    {preview.items.map(it=>(
                      <tr key={it.category.id}><td style={{fontWeight:650}}>{it.category.label}</td><td className="mono">{it.count}</td><td className="mono">{formatBytes(it.bytes)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div style={{padding:14,display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                  <button className="btn" style={{background:'var(--red)',color:'#fff',borderColor:'#7a1f1f'}} onClick={onExecute} disabled={executing || preview.totalCount===0}>{executing? 'Executing…' : `Confirm & delete ${preview.totalCount} files (${formatBytes(preview.totalBytes)})`}</button>
                  <span style={{fontSize:11,color:'var(--muted)'}}>Goes to {deletionMode==='recycle'?'Recycle Bin':'permanent delete'}. Stop button aborts mid-run leaving disk untouched.</span>
                </div>
              </>
            )}
          </div>
          <div style={{padding:'12px 14px', borderTop:'1px solid var(--border)'}}>
            <div style={{fontWeight:750,fontSize:12,marginBottom:8}}>Recent actions</div>
            {log.length===0? <div style={{fontSize:12,color:'var(--muted)'}}>No cleanups yet.</div> : log.slice(-5).reverse().map((e,i)=>(
              <div key={i} className="mono" style={{fontSize:11,padding:'6px 0',borderBottom:'1px solid var(--border)',color:'var(--muted)'}}>
                {new Date(e.ts).toLocaleString()} — {e.mode} — {e.count} files • {formatBytes(e.bytes)} {e.files?.slice(0,1).map(f=>`— ${f.path}`).join('')}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
