export function nextRunTime(schedule, timeOfDay, now=new Date()){
  if(schedule==='manual') return null
  const [h,m]= timeOfDay.split(':').map(Number)
  const next=new Date(now)
  next.setHours(h,m,0,0)
  if(next <= now){
    if(schedule==='daily') next.setDate(next.getDate()+1)
    else if(schedule==='weekly') next.setDate(next.getDate()+7)
  }
  return next
}
export function formatNextRun(d){
  if(!d) return 'Manual only'
  return d.toLocaleString()
}
