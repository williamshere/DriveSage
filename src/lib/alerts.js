// Alerts with 24h debounce per drive per type
export const ALERT_TYPES = ['temperature','wear','freeSpace']

export function checkAlerts(drive, thresholds, now=Date.now()){
  const alerts=[]
  if(drive.temperature != null && drive.temperature >= thresholds.tempCritical) alerts.push({type:'temperature', level:'critical', msg:`${drive.letter} critical temperature ${drive.temperature}°C`})
  else if(drive.temperature != null && drive.temperature >= thresholds.tempWarning) alerts.push({type:'temperature', level:'warning', msg:`${drive.letter} temperature ${drive.temperature}°C above ${thresholds.tempWarning}°C`})
  if(drive.wearPercent != null && drive.wearPercent >= thresholds.wearWarning) alerts.push({type:'wear', level:'warning', msg:`${drive.letter} wear ${drive.wearPercent}% exceeds ${thresholds.wearWarning}%`})
  const freePct = drive.freeBytes!=null && drive.capacityBytes ? (drive.freeBytes/drive.capacityBytes*100) : 100
  if(freePct <= thresholds.freeSpaceWarningPct) alerts.push({type:'freeSpace', level:'warning', msg:`${drive.letter} low free space ${freePct.toFixed(1)}%`})
  return alerts
}

export function shouldDebounce(alertLog, driveId, type, now=Date.now()){
  const key = `${driveId}:${type}`
  const last = alertLog[key]
  if(!last) return false
  return (now - last) < 24*3600*1000
}

export function recordAlert(alertLog, driveId, type, now=Date.now()){
  alertLog[`${driveId}:${type}`]=now
  return alertLog
}
