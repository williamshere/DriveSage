import React, { memo, useMemo, useState } from 'react'
import { formatBytes } from '../lib/drives.js'
import { computeHealth, bandColor } from '../lib/health.js'
import { checkAlerts } from '../lib/alerts.js'
import { exportDrivesCsv, copyDriveInfo } from '../lib/export.js'
import { summarizeSystemStatus } from '../lib/recommendations.js'

const HealthRing = memo(function HealthRing({ score, band }) {
  const color = bandColor(band)
  return (
    <div className="health-ring" style={{ background: `conic-gradient(${color} ${score}%, var(--panel-3) 0)` }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--panel)', display: 'grid', placeItems: 'center', border: '1px solid var(--border)' }}>
        <div style={{ textAlign: 'center' }}>
          <b style={{ color }}>{score}</b><br /><em>{band}</em>
        </div>
      </div>
    </div>
  )
})

const DriveCard = memo(function DriveCard({ drive, history, onSelect }) {
  const health = computeHealth({
    wearPercent: drive.wearPercent ?? 0,
    tempHistory: history?.temps || [],
    maxTemp: drive.temperature ?? 0,
    warningTemp: 50,
    reallocated: drive.reallocated ?? 0,
    pending: drive.pending ?? 0,
    crcErrors: drive.crcErrors ?? 0,
  })
  const capacityBytes = drive.capacityBytes || 0
  const freeBytes = drive.freeBytes || 0
  const occupiedPct = capacityBytes ? Math.round((1 - freeBytes / capacityBytes) * 100) : 0
  const [copied, setCopied] = useState(false)

  const handleCopy = (event) => {
    event.stopPropagation()
    copyDriveInfo(drive)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const handleOpen = (event) => {
    event.stopPropagation()
    if (window.__TAURI__ && window.__TAURI__.shell) {
      window.__TAURI__.shell.open(`${drive.letter}\\`)
    } else if (window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('scanner', { path: `${drive.letter}\\` }).catch(() => {})
      try { window.__TAURI__.core.invoke('open_path', { path: `${drive.letter}\\` }) } catch {}
    } else {
      alert(`Drive path: ${drive.letter}\\ \nModel: ${drive.model}\nSerial: ${drive.serial}\nCapacity: ${formatBytes(capacityBytes)}\nFree: ${formatBytes(freeBytes)}\n\nTip: in Tauri desktop app this opens File Explorer (read-only).`)
    }
  }

  return (
    <div className="card drive-card" onClick={() => onSelect(drive.id)} style={{ position: 'relative' }}>
      <div className="drive-top">
        <div style={{ minWidth: 0 }}>
          <div className="drive-letter">{drive.letter} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginLeft: 6 }}>{drive.type}</span></div>
          <div className="drive-model" title={drive.model}>{drive.model}</div>
          <div className="drive-meta mono">{drive.serial} • {formatBytes(capacityBytes)} • {drive.powerOnHours ? `${drive.powerOnHours.toLocaleString()} hrs` : 'hours unavailable'}</div>
        </div>
        <HealthRing score={health.score} band={health.band} />
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
          <span className="mono">{formatBytes(capacityBytes - freeBytes)} used</span><span className="mono">{formatBytes(freeBytes)} free</span>
        </div>
        <div className={`bar ${occupiedPct > 85 ? 'warn' : ''}`}><i style={{ width: `${occupiedPct}%` }} /></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
          <span>{occupiedPct}% occupied</span><span className="mono" title="Read-only via Get-StorageReliabilityCounter / MSStorageDriver; unavailable when non-admin or unsupported">{drive.temperature != null ? `${drive.temperature}°C` : 'temp unavailable'}</span>
        </div>
      </div>
      <div className="breakdown">
        <span>Lifespan <strong>{health.breakdown.lifespan}</strong></span>
        <span>Temp <strong>{health.breakdown.temperature}</strong></span>
        <span>Errors <strong>{health.breakdown.errors}</strong></span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`badge ${health.band === 'Healthy' ? 'badge-healthy' : health.band === 'Watch' ? 'badge-watch' : 'badge-risk'}`}>{health.band}</span>
        {drive.wearPercent != null && <span className="pill mono">wear {drive.wearPercent}%</span>}
        {drive.wearPercent == null && <span className="pill mono" title="Wear requires SMART read-only access">wear unavailable</span>}
        {drive.reallocated > 0 && <span className="pill" style={{ color: 'var(--red)' }}>reallocated {drive.reallocated}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button className="btn btn-sm" onClick={handleCopy} title="Copy drive info to clipboard">{copied ? 'Copied!' : 'Copy info'}</button>
        <button className="btn btn-sm" onClick={handleOpen} title="Open drive in File Explorer (read-only)">Open</button>
      </div>
    </div>
  )
})

export default function Dashboard({ drives, histories, settings, onSelectDrive, onScan, scanning, onStopScan, progress, scanError }) {
  const alerts = useMemo(() => drives.flatMap((drive) => (
    checkAlerts(drive, {
      tempWarning: settings.tempWarning,
      tempCritical: settings.tempCritical,
      wearWarning: settings.wearWarning,
      freeSpaceWarningPct: settings.freeSpaceWarning,
    }).map((alert) => ({ ...alert, driveId: drive.id }))
  )), [drives, settings])

  const totalBytes = useMemo(() => drives.reduce((total, drive) => total + (drive.capacityBytes || 0), 0), [drives])
  const freeBytes = useMemo(() => drives.reduce((total, drive) => total + (drive.freeBytes || 0), 0), [drives])
  const systemSummary = useMemo(() => summarizeSystemStatus(drives, histories, settings), [drives, histories, settings])

  const historyMap = useMemo(() => {
    const map = new Map()
    for (const history of histories) {
      if (!map.has(history.driveId)) map.set(history.driveId, history)
    }
    return map
  }, [histories])

  const sortedDrives = useMemo(() => [...drives].sort((a, b) => {
    const aCapacity = a.capacityBytes || 0
    const bCapacity = b.capacityBytes || 0
    const aOccupied = aCapacity ? (aCapacity - (a.freeBytes || 0)) / aCapacity : 0
    const bOccupied = bCapacity ? (bCapacity - (b.freeBytes || 0)) / bCapacity : 0
    return bOccupied - aOccupied
  }), [drives])

  const healthOverview = useMemo(() => drives.map((drive) => {
    const health = computeHealth({
      wearPercent: drive.wearPercent ?? 0,
      maxTemp: drive.temperature ?? 0,
      tempHistory: historyMap.get(drive.id)?.temps || [],
      reallocated: drive.reallocated ?? 0,
      pending: drive.pending ?? 0,
      crcErrors: drive.crcErrors ?? 0,
    })
    return (
      <div key={drive.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
        <span className="mono" style={{ fontSize: 13 }}>{drive.letter} {drive.model.split(' ').slice(0, 2).join(' ')}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="mono" style={{ fontWeight: 800 }}>{health.score}</span>
          <span className={`badge ${health.band === 'Healthy' ? 'badge-healthy' : health.band === 'Watch' ? 'badge-watch' : 'badge-risk'}`} style={{ fontSize: 10 }}>{health.band}</span>
        </span>
      </div>
    )
  }), [drives, historyMap])

  const capacityOverview = useMemo(() => sortedDrives.map((drive) => {
    const capacityBytes = drive.capacityBytes || 0
    const occupiedPct = capacityBytes ? Math.round((1 - (drive.freeBytes || 0) / capacityBytes) * 100) : 0
    return (
      <div key={drive.id} style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><b>{drive.letter}</b><span className="mono">{occupiedPct}%</span></div>
        <div className={`bar ${occupiedPct > 85 ? 'warn' : ''}`} style={{ marginTop: 6 }}><i style={{ width: `${occupiedPct}%` }} /></div>
      </div>
    )
  }), [sortedDrives])

  const driveCards = useMemo(() => drives.map((drive) => (
    <DriveCard key={drive.id} drive={drive} history={historyMap.get(drive.id)} onSelect={onSelectDrive} />
  )), [drives, historyMap, onSelectDrive])

  const realDrivesSafetyList = useMemo(() => drives.map((drive) => (
    <div key={drive.id} className="mono" style={{ fontSize: 11, marginTop: 4 }}>
      {drive.letter} {drive.model} — {formatBytes(drive.capacityBytes)} free {formatBytes(drive.freeBytes)} {drive.temperature != null ? `• ${drive.temperature}°C` : '• temp unavailable'}
    </div>
  )), [drives])

  return (
    <div>
      <div className="topbar">
        <h1 className="h1">Dashboard <small className="mono">{drives.length} drives • {formatBytes(totalBytes)} total • {formatBytes(freeBytes)} free</small></h1>
        <div className="top-actions" style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => exportDrivesCsv(drives)} title="Export real drive list as CSV (read-only)">Export CSV</button>
          {!scanning ? <button className="btn btn-primary" onClick={onScan}>Scan now</button> : <button className="btn" onClick={onStopScan}>Stop scan</button>}
        </div>
      </div>

      <div className="card" style={{ padding: '12px 14px', marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
        <span style={{ fontWeight: 700 }}>Diagnostics:</span>
        <span className="mono" style={{ color: 'var(--muted)' }}>{drives.length} real drives • WMI Get-PhysicalDisk/Get-StorageReliabilityCounter read-only • SMART “unavailable” when non-admin or unsupported (never writes firmware/clocks/RAID)</span>
        <span className="pill mono" style={{ marginLeft: 'auto' }}>Read-only • No network • No telemetry</span>
      </div>

      {scanError && <div className="card" role="alert" style={{ padding: '10px 14px', marginBottom: 12, color: 'var(--amber)' }}>{scanError}</div>}

      {scanning && (
        <div className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>Scanning — {progress.phase}</div>
            <div className="bar indeterminate" style={{ marginTop: 8 }}><i /></div>
          </div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{(progress.filesScanned||0).toLocaleString()} files • {formatBytes(progress.bytesScanned||0)}</div>
        </div>
      )}

      {alerts.length > 0 && (
        <div className={`alert-banner ${alerts.some((alert) => alert.level === 'critical') ? 'critical' : ''}`}>
          <span style={{ fontSize: 18 }}>{alerts.some((alert) => alert.level === 'critical') ? '▲' : '●'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>System alerts — {alerts.length}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{alerts.map((alert) => alert.msg).join(' • ')}</div>
          </div>
        </div>
      )}

      <div className="grid grid-3">{driveCards}</div>

      <div className="grid grid-4" style={{ marginTop: 14 }}>
        <div className="card"><div className="card-head"><div className="card-title">Health overview</div></div>
          <div className="card-body">
            {healthOverview}
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>40% lifespan • 30% temperature • 30% errors — breakdown per drive</div>
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Capacity at a glance</div><span className="card-sub mono">largest bar = most full</span></div>
          <div className="card-body">
            {capacityOverview}
            <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => exportDrivesCsv(drives)}>Download CSV report</button>
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Action center</div><span className={`badge ${systemSummary.status === 'Healthy' ? 'badge-healthy' : systemSummary.status === 'Watch' ? 'badge-watch' : 'badge-risk'}`} style={{ fontSize: 10 }}>{systemSummary.status}</span></div>
          <div className="card-body">
            <div className="stat" style={{ fontSize: 18, lineHeight: 1.2 }}>{systemSummary.worstDrive ? systemSummary.worstDrive.letter : '—'} <small>{systemSummary.worstDrive ? `${systemSummary.worstDrive.score} / 100` : 'No drives'}</small></div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{systemSummary.summary}</div>
            <div className="recommendation-list">
              {systemSummary.recommendations.map((recommendation, index) => (
                <div key={`${recommendation.drive || 'system'}-${index}`} className={`recommendation-item ${recommendation.priority}`}>
                  <div className="recommendation-tag">{recommendation.priority}</div>
                  <div>
                    <div className="recommendation-title">{recommendation.title}</div>
                    <div className="recommendation-detail">{recommendation.drive ? `${recommendation.drive} • ` : ''}{recommendation.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card"><div className="card-head"><div className="card-title">Safety & Real Data</div></div>
          <div className="card-body" style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--muted)' }}>
            <div style={{ color: 'var(--text)', fontWeight: 700 }}>Read-only hardware access</div>
            SMART + capacity via Windows APIs only (<code>Get-PhysicalDisk</code>, <code>Get-StorageReliabilityCounter</code>, MSStorageDriver). No writes to firmware, clocks or RAID.<br />
            <div style={{ color: 'var(--text)', fontWeight: 700, marginTop: 10 }}>Real drives on this machine</div>
            {realDrivesSafetyList}
            <div style={{ color: 'var(--text)', fontWeight: 700, marginTop: 10 }}>Deletions go to Recycle Bin</div>
            Permanent delete only on explicit choice per run. Every action logged. <code>unavailable</code> shown for any unreadable attribute.
          </div>
        </div>
      </div>
    </div>
  )
}
