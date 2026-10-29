export default function Settings({ settings, setSettings }){
  const upd=(k,v)=> setSettings(s=>({...s,[k]:v}))
  return (
    <div>
      <div className="topbar"><h1 className="h1">Settings <small style={{color:'var(--muted)'}}>persisted • applied without restart</small></h1></div>

      <div className="settings-grid">
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div className="card"><div className="card-head"><div className="card-title">Scan schedule</div></div>
            <div className="card-body" style={{display:'flex',flexDirection:'column',gap:10}}>
              <label style={{fontSize:12,color:'var(--muted)',fontWeight:650}}>Schedule</label>
              <select className="select" value={settings.schedule} onChange={e=>upd('schedule',e.target.value)}>
                <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="manual">Manual only</option>
              </select>
              <label style={{fontSize:12,color:'var(--muted)',fontWeight:650}}>Time of day</label>
              <input className="input mono" type="time" value={settings.timeOfDay} onChange={e=>upd('timeOfDay',e.target.value)} />
              <div style={{fontSize:11,color:'var(--muted)'}}>Next run is computed locally; scheduler fires in-app. Background scans respect max depth & file-count cap.</div>
            </div>
          </div>

          <div className="card"><div className="card-head"><div className="card-title">Thresholds</div></div>
            <div className="card-body" style={{display:'flex',flexDirection:'column',gap:12}}>
              <label style={{fontSize:12}}>Temp warning (°C) <input className="input mono" type="number" value={settings.tempWarning} onChange={e=>upd('tempWarning', Number(e.target.value))} /></label>
              <label style={{fontSize:12}}>Temp critical (°C) <input className="input mono" type="number" value={settings.tempCritical} onChange={e=>upd('tempCritical', Number(e.target.value))} /></label>
              <label style={{fontSize:12}}>Wear warning (%) <input className="input mono" type="number" value={settings.wearWarning} onChange={e=>upd('wearWarning', Number(e.target.value))} /></label>
              <label style={{fontSize:12}}>Free-space warning (%) <input className="input mono" type="number" value={settings.freeSpaceWarning} onChange={e=>upd('freeSpaceWarning', Number(e.target.value))} /></label>
            </div>
          </div>

          <div className="card"><div className="card-head"><div className="card-title">Behavior</div></div>
            <div className="card-body" style={{display:'flex',flexDirection:'column',gap:12}}>
              <label style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:13}}>
                Autostart (launch minimized to tray) <input type="checkbox" className="check" checked={!!settings.autostart} onChange={e=>upd('autostart', e.target.checked)} />
              </label>
              <label style={{fontSize:12}}>Snapshot retention (days)
                <input className="input mono" type="number" value={settings.retentionDays} onChange={e=>upd('retentionDays', Number(e.target.value))} style={{marginTop:6}}/>
              </label>
              <label style={{fontSize:12}}>Max scan depth <input className="input mono" type="number" value={settings.maxDepth} onChange={e=>upd('maxDepth', Number(e.target.value))} /></label>
              <label style={{fontSize:12}}>File-count cap <input className="input mono" type="number" value={settings.fileCountCap} onChange={e=>upd('fileCountCap', Number(e.target.value))} /></label>
            </div>
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div className="card"><div className="card-head"><div className="card-title">Excluded paths</div><span className="card-sub">skip during scans • respects safety rules</span></div>
            <div className="card-body">
              {(settings.excludedPaths||[]).length===0? <div style={{fontSize:12,color:'var(--muted)'}}>No exclusions.</div> : (
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {settings.excludedPaths.map(p=>(
                    <div key={p} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 10px',background:'var(--panel-2)',border:'1px solid var(--border)',borderRadius:8}}>
                      <span className="mono" style={{fontSize:12}}>{p}</span>
                      <button className="btn" style={{padding:'4px 8px',fontSize:11}} onClick={()=> upd('excludedPaths', settings.excludedPaths.filter(x=>x!==p))}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{display:'flex',gap:8,marginTop:10}}>
                <input id="newEx" className="input mono" placeholder="C:\Users\Willi\Scratch" style={{flex:1}} />
                <button className="btn" onClick={()=>{
                  const el=document.getElementById('newEx'); const v=el.value.trim(); if(!v) return; upd('excludedPaths', [...(settings.excludedPaths||[]), v]); el.value=''
                }}>Add</button>
              </div>
            </div>
          </div>

          <div className="card"><div className="card-head"><div className="card-title">Cleanup categories enabled</div></div>
            <div className="card-body" style={{display:'flex',flexDirection:'column',gap:8}}>
              {['winTemp','userTemp','recycleBin','thumbCache','deliveryOpt'].map(id=>(
                <label key={id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:13}}>
                  {id} <input type="checkbox" className="check" checked={(settings.enabledCategories||[]).includes(id)} onChange={e=>{
                    const cur=settings.enabledCategories||[]; const nxt=e.target.checked? [...cur,id] : cur.filter(x=>x!==id); upd('enabledCategories', nxt)
                  }} />
                </label>
              ))}
              <div style={{fontSize:11,color:'var(--muted)'}}>Nothing else is cleanable. Safety: Documents/Pictures/Desktop/Downloads never touched unless you add them explicitly.</div>
            </div>
          </div>

          <div className="card"><div className="card-head"><div className="card-title">Theme</div></div>
            <div className="card-body" style={{display:'flex',gap:10}}>
              <button className="btn" style={{flex:1, background: settings.theme==='dark'?'var(--panel-3)':'var(--panel-2)'}} onClick={()=>upd('theme','dark')}>Dark (default)</button>
              <button className="btn" style={{flex:1, background: settings.theme==='light'?'var(--panel-3)':'var(--panel-2)'}} onClick={()=>upd('theme','light')}>Light</button>
            </div>
          </div>

          <div className="card" style={{padding:14}}>
            <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.6}}>
              <b style={{color:'var(--text)'}}>Local-first guarantees:</b> No network calls, no accounts, no telemetry. Settings are stored in localStorage; scan history in IndexedDB-style store next to app data. Deletions default to Recycle Bin.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
