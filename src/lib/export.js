export function exportDrivesCsv(drives){
  const header = ['Letter','Model','Serial','CapacityBytes','FreeBytes','UsedBytes','Type','Health','Temperature','Wear%']
  const rows = drives.map(d=>{
    const used = (d.capacityBytes!=null && d.freeBytes!=null) ? d.capacityBytes - d.freeBytes : ''
    return [
      d.letter||'unavailable',
      `"${(d.model||'unavailable').replace(/"/g,'""')}"`,
      d.serial||'unavailable',
      d.capacityBytes ?? 'unavailable',
      d.freeBytes ?? 'unavailable',
      used===''? 'unavailable' : used,
      d.type||'unavailable',
      d.healthStatus||'unavailable',
      d.temperature ?? 'unavailable',
      d.wearPercent ?? 'unavailable'
    ].join(',')
  })
  const csv = [header.join(','), ...rows].join('\n')
  const blob = new Blob([csv], {type:'text/csv'})
  const url = URL.createObjectURL(blob)
  const a=document.createElement('a'); a.href=url; a.download=`drivesage-drives-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url)
}

export function copyDriveInfo(drive){
  const text = `${drive.letter} ${drive.model} | Serial: ${drive.serial} | Capacity: ${drive.capacityBytes||'unavailable'} | Free: ${drive.freeBytes||'unavailable'}`
  if(navigator.clipboard) navigator.clipboard.writeText(text)
  return text
}
