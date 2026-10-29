import React from 'react'
import { formatBytes } from '../lib/drives.js'

function Treemap({ node, onDrill, path }){
  const children = node.children || []
  if(children.length===0) return <div className="mono" style={{fontSize:12,color:'var(--muted)'}}>No children.</div>
  // sort largest first
  const sorted=[...children].sort((a,b)=>b.size-a.size)
  // simple row layout: first row large, rest grid
  return (
    <div className="treemap">
      <div className="tm-row">
        {sorted.map(c=>{
          const pct = Math.round(c.size / node.size * 100)
          return (
            <div key={c.name} className="tm-block" onClick={()=> c.children && onDrill([...path, c.name], c)} style={{minHeight: c.children? 92: 72}}>
              <b>{c.name}</b>
              <span className="mono">{formatBytes(c.size)} • {pct}%</span>
              <div className="bar" style={{marginTop:8,height:6}}><i style={{width:`${pct}%`,background:'#2ec5a0'}}/></div>
              {c.children && <span style={{fontSize:11,color:'var(--teal)',fontWeight:700,marginTop:6,display:'inline-block'}}>Drill in →</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function StorageMap({ tree, scanning, progress, onScan, onStopScan }){
  // drill state lives here
  const [stack, setStack] = React.useState([])
  const current = stack.length===0 ? tree : stack[stack.length-1].node
  const pathNames = stack.map(s=>s.name)
  const totalSize = tree.size
  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Storage map <small className="mono">{formatBytes(totalSize)} scanned • excludes system paths</small></h1>
        <div className="top-actions">
          {!scanning ? <button className="btn btn-primary" onClick={onScan}>Rescan</button> : <button className="btn" onClick={onStopScan}>Stop</button>}
        </div>
      </div>

      {scanning && (
        <div className="card" style={{padding:14,marginBottom:14,display:'flex',gap:12,alignItems:'center'}}>
          <div style={{flex:1}}><div style={{fontSize:12,fontWeight:700,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em'}}>{progress.phase}</div><div className="bar" style={{marginTop:8}}><i style={{width:`${progress.pct}%`}}/></div></div>
          <span className="mono" style={{fontSize:12}}>{progress.pct}%</span>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button className="btn btn-ghost" onClick={()=>setStack([])} disabled={stack.length===0}>Root</button>
            {stack.length>0 && <button className="btn" onClick={()=>setStack(s=>s.slice(0,-1))}>Up</button>}
            <span className="mono" style={{fontSize:12,color:'var(--muted)'}}>{['C:',...pathNames].join(' / ')}</span>
          </div>
          <span className="card-sub mono">{formatBytes(current.size)} • largest first • click to drill</span>
        </div>
        <div className="card-body">
          <Treemap node={current} onDrill={(p,c)=> setStack(s=>[...s,{name:c.name, node:c}])} path={pathNames} />
          <div style={{marginTop:12,fontSize:11,color:'var(--muted)',lineHeight:1.5}}>Treemap excludes <span className="mono">C:\Windows</span>, <span className="mono">Program Files</span> and hidden OS folders by default. Respects max depth and file-count cap. Click a block with children to drill in.</div>
        </div>
      </div>
    </div>
  )
}
