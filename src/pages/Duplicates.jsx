import { formatBytes } from '../lib/drives.js'

export default function Duplicates({ files, dupes, largest, scanning, progress, onScan, onStopScan }){
  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Duplicates & large files <small className="mono">{files.length} files indexed • hash-confirmed</small></h1>
        <div className="top-actions">
          {!scanning ? <button className="btn btn-primary" onClick={onScan}>Find duplicates</button> : <button className="btn" onClick={onStopScan}>Stop</button>}
        </div>
      </div>

      {scanning && (
        <div className="card" style={{padding:14,marginBottom:14,display:'flex',gap:12,alignItems:'center'}}>
          <div style={{flex:1}}><div style={{fontSize:12,fontWeight:700,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em'}}>{progress.phase}</div><div className="bar" style={{marginTop:8}}><i style={{width:`${progress.pct}%`}}/></div></div>
          <span className="mono" style={{fontSize:12}}>{progress.pct}%</span>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div className="card-title">Duplicate groups</div><span className="card-sub mono">{dupes.groups.length} groups • {formatBytes(dupes.reclaimable)} reclaimable</span></div>
          <div className="card-body" style={{padding:0}}>
            {dupes.groups.length===0? <div style={{padding:20,color:'var(--muted)',fontSize:13}}>No duplicates found. Run a scan.</div> : (
              <table className="table">
                <thead><tr><th>Group</th><th>Files</th><th>Size each</th><th>Reclaimable</th></tr></thead>
                <tbody>
                  {dupes.groups.map((g,i)=>{
                    const per = g[0].size
                    const reclaim = g.reduce((a,b)=>a+b.size,0) - per
                    return (
                      <tr key={i}>
                        <td>
                          <div style={{fontWeight:650,fontSize:12}}>{g[0].path.split('\\').pop()} ×{g.length}</div>
                          <div className="mono" style={{fontSize:11,color:'var(--muted)',maxWidth:360,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{g.map(f=>f.path).join(' • ')}</div>
                        </td>
                        <td className="mono">{g.length}</td>
                        <td className="mono">{formatBytes(per)}</td>
                        <td className="mono" style={{color:'var(--teal)',fontWeight:700}}>{formatBytes(reclaim)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div style={{padding:'10px 14px',fontSize:11,color:'var(--muted)',borderTop:'1px solid var(--border)'}}>Stage 1: group by size → Stage 2: first-block hash → Stage 3: full hash. Only survivors count.</div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Largest files</div><span className="card-sub mono">top 20</span></div>
          <div className="card-body" style={{padding:0}}>
            <table className="table">
              <thead><tr><th>File</th><th>Size</th></tr></thead>
              <tbody>
                {largest.map(f=>(
                  <tr key={f.path}>
                    <td><div className="mono" style={{fontSize:11,maxWidth:320,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={f.path}>{f.path}</div></td>
                    <td className="mono" style={{fontWeight:700}}>{formatBytes(f.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
