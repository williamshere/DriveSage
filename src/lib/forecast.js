// Forecast: linear regression on free-space history -> days until full
// Requires 7 days of data minimum
export function estimateDaysUntilFull(history) {
  // history: [{ts:number (ms), freeBytes:number}]
  if (!history || history.length < 7) return { days: null, reason: 'insufficient history' }
  // sort by ts
  const pts = [...history].sort((a,b)=>a.ts-b.ts)
  const n = pts.length
  // use days since first point as x
  const t0 = pts[0].ts
  const xs = pts.map(p => (p.ts - t0) / 86400000)
  const ys = pts.map(p => p.freeBytes)
  // linear regression y = m*x + b ; m negative means losing free space
  const meanX = xs.reduce((a,b)=>a+b,0)/n
  const meanY = ys.reduce((a,b)=>a+b,0)/n
  let num=0, den=0
  for (let i=0;i<n;i++){ num += (xs[i]-meanX)*(ys[i]-meanY); den += (xs[i]-meanX)**2 }
  if (den===0) return { days:null, reason:'insufficient history' }
  const m = num/den
  const b = meanY - m*meanX
  if (m >= 0) return { days: Infinity, reason: 'not filling', slope: m, intercept: b }
  // when will free reach 0? solve m*x + b = 0 => x = -b/m
  const xZero = -b / m
  const lastX = xs[xs.length-1]
  const daysRemaining = xZero - lastX
  if (daysRemaining < 0) return { days: 0, slope: m, intercept: b }
  return { days: Math.round(daysRemaining), slope: m, intercept: b }
}

export function formatForecast(res){
  if (res.days === null) return 'Insufficient history — need 7 days'
  if (res.days === Infinity) return 'Stable — not trending toward full'
  if (res.days === 0) return 'At capacity'
  if (res.days === 1) return '1 day until full'
  return `${res.days} days until full`
}
