import React, { memo } from 'react'

const items=[
  {id:'dashboard', label:'Dashboard', icon:'◧'},
  {id:'drive', label:'Drive detail', icon:'◎'},
  {id:'map', label:'Storage map', icon:'▦'},
  {id:'dupes', label:'Duplicates', icon:'⧉'},
  {id:'cleanup', label:'Cleanup', icon:'✦'},
  {id:'history', label:'History', icon:'◷'},
  {id:'settings', label:'Settings', icon:'⚙'},
]

// ⚡ Bolt: Sidebar memoization
// 💡 What: Used React.memo() on Sidebar and moved items array outside.
// 🎯 Why: Sidebar re-rendered every 260ms during scans because App's progress state changed.
// 📊 Impact: Substantially reduces CPU workload during active scans by avoiding unnecessary nav re-renders.
export default memo(function Sidebar({ page, setPage, theme, setTheme, settings, scanCount }){
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">DS</div>
        <div>
          <div className="brand-title">DriveSage</div>
          <div className="brand-sub">Storage Health Studio</div>
        </div>
      </div>
      <nav className="nav">
        {items.map(it=>(
          <button key={it.id} className={`nav-btn ${page===it.id?'active':''}`} onClick={()=>setPage(it.id)}>
            <span className="nav-ico">{it.icon}</span> {it.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="foot-label">System</div>
        <div className="foot-row"><span>Theme</span>
          <div className={`toggle ${theme==='light'?'on':''}`} onClick={()=>setTheme(theme==='dark'?'light':'dark')}><i/></div>
        </div>
        <div className="foot-row"><span>Scans</span><span className="mono" style={{color:'var(--muted)'}}>{scanCount} total</span></div>
        <div className="foot-row"><span>Schedule</span><span style={{fontSize:11,color:'var(--teal)',fontWeight:700}}>{settings.schedule}</span></div>
        <div style={{marginTop:10,fontSize:11,color:'var(--muted-2)',lineHeight:1.4}}>Local-first • No network • No telemetry<br/>All data stays on this machine.</div>
      </div>
    </aside>
  )
}
