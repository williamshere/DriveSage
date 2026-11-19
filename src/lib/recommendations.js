import { formatBytes } from './drives.js'
import { computeHealth } from './health.js'

function priorityWeight(priority) {
  if (priority === 'critical') return 3
  if (priority === 'warning') return 2
  return 1
}

export function buildDriveRecommendation(drive, history = [], settings = {}) {
  const warningTemp = settings.tempWarning ?? 50
  const criticalTemp = settings.tempCritical ?? 60
  const freeWarnPct = settings.freeSpaceWarning ?? 10
  const health = computeHealth({
    wearPercent: drive.wearPercent ?? 0,
    tempHistory: history?.temps || [],
    maxTemp: drive.temperature ?? 0,
    warningTemp,
    reallocated: drive.reallocated ?? 0,
    pending: drive.pending ?? 0,
    crcErrors: drive.crcErrors ?? 0,
  })

  const capacity = drive.capacityBytes || 0
  const freeBytes = drive.freeBytes || 0
  const freePct = capacity > 0 ? Math.round((freeBytes / capacity) * 100) : 100
  const recommendations = []

  if (drive.temperature != null && drive.temperature >= criticalTemp) {
    recommendations.push({
      priority: 'critical',
      title: 'Cool the drive down',
      detail: `${drive.letter} is at ${drive.temperature}°C. Reduce workload and improve airflow before the drive is stressed further.`,
    })
  } else if (drive.temperature != null && drive.temperature >= warningTemp) {
    recommendations.push({
      priority: 'warning',
      title: 'Watch temperature',
      detail: `${drive.letter} is running hot at ${drive.temperature}°C; keep the case cool and avoid sustained heavy writes.`,
    })
  }

  if ((drive.reallocated ?? 0) > 0 || (drive.pending ?? 0) > 0 || (drive.crcErrors ?? 0) > 0) {
    recommendations.push({
      priority: 'critical',
      title: 'Backup and check SMART',
      detail: `Drive ${drive.letter} has read/write error indicators. Back up critical files now and investigate the SMART counters.`,
    })
  }

  if (drive.wearPercent != null && drive.wearPercent >= (settings.wearWarning ?? 70)) {
    recommendations.push({
      priority: 'warning',
      title: 'Wear is elevated',
      detail: `${drive.letter} is at ${drive.wearPercent}% wear. Plan replacement before failure becomes likely.`,
    })
  }

  if (capacity > 0 && freePct <= freeWarnPct) {
    recommendations.push({
      priority: 'warning',
      title: 'Free space is low',
      detail: `${drive.letter} has ${formatBytes(freeBytes)} remaining (${freePct}% free). Move large files or archive older data soon.`,
    })
  }

  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'info',
      title: 'Healthy status',
      detail: `${drive.letter} is operating normally. Keep the current scan cadence and continue monitoring.`,
    })
  }

  return {
    driveId: drive.id,
    letter: drive.letter || 'Drive',
    model: drive.model || 'Unknown model',
    health,
    freePct,
    recommendations: recommendations
      .slice()
      .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority))
      .slice(0, 3),
  }
}

export function summarizeSystemStatus(drives = [], histories = [], settings = {}) {
  if (!drives.length) {
    return {
      status: 'No drives',
      summary: 'No physical drives were detected on this machine.',
      worstDrive: null,
      recommendations: [{ priority: 'info', title: 'No hardware detected', detail: 'Add a drive or run a fresh scan to establish a baseline.' }],
    }
  }

  const analyses = drives.map((drive) => {
    const history = histories.find((entry) => entry.driveId === drive.id) || { temps: [], frees: [] }
    return buildDriveRecommendation(drive, history, settings)
  })

  const worstDrive = analyses.reduce((worst, current) => {
    if (!worst) return current
    return current.health.score < worst.health.score ? current : worst
  }, null)

  const totalAlerts = analyses.reduce((total, current) => total + current.recommendations.filter((r) => r.priority !== 'info').length, 0)
  const status = worstDrive && worstDrive.health.score < 50 ? 'At risk' : worstDrive && worstDrive.health.score < 80 ? 'Watch' : 'Healthy'

  const recommendations = analyses
    .flatMap((analysis) => analysis.recommendations.map((rec) => ({ ...rec, drive: analysis.letter })))
    .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority))
    .slice(0, 4)

  return {
    status,
    summary: worstDrive
      ? `${worstDrive.letter} is the lowest-scoring drive in the system.`
      : 'All drives are healthy.',
    worstDrive: worstDrive ? { id: worstDrive.driveId, letter: worstDrive.letter, model: worstDrive.model, score: worstDrive.health.score, band: worstDrive.health.band } : null,
    totalAlerts,
    recommendations,
  }
}
