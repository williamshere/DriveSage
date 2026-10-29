// Health scoring: 40% lifespan, 30% temperature, 30% error indicators. Bands: 80+ Healthy, 50-79 Watch, <50 At risk
export function computeHealth({ wearPercent = 0, tempHistory = [], maxTemp = 55, warningTemp = 50, reallocated = 0, pending = 0, crcErrors = 0 } = {}) {
  // Lifespan: wearPercent is 0-100, remaining = 100 - wear
  const remaining = Math.max(0, 100 - (wearPercent || 0))
  const lifespanScore = Math.max(0, Math.min(100, remaining))
  // Temperature: fraction of readings above warning threshold
  let tempScore = 100
  if (tempHistory && tempHistory.length > 0) {
    const over = tempHistory.filter(t => t > warningTemp).length
    const ratio = over / tempHistory.length
    // penalize: 0% over ->100, 20% over ->70, 50% over ->30
    tempScore = Math.round(100 - ratio * 140)
    tempScore = Math.max(0, Math.min(100, tempScore))
    // extra penalty if current max far above critical
    if (maxTemp > warningTemp + 15) tempScore = Math.max(0, tempScore - 20)
    else if (maxTemp > warningTemp + 8) tempScore = Math.max(0, tempScore - 10)
  } else {
    // if no history but maxTemp provided, estimate
    if (maxTemp > warningTemp + 15) tempScore = 60
    else if (maxTemp > warningTemp + 5) tempScore = 80
  }
  // Error indicators
  let errorScore = 100
  const totalErr = (reallocated || 0) + (pending || 0) * 2 + (crcErrors || 0) * 3
  if (totalErr === 0) errorScore = 100
  else if (totalErr <= 2) errorScore = 85
  else if (totalErr <= 8) errorScore = 60
  else if (totalErr <= 20) errorScore = 35
  else errorScore = 10

  let score = Math.round(lifespanScore * 0.4 + tempScore * 0.3 + errorScore * 0.3)
  // Cap overall score when any dimension is critically low — prevents a high average masking failure
  if (errorScore <= 10) score = Math.min(score, 45)
  else if (errorScore <= 35) score = Math.min(score, 62)
  if (lifespanScore <= 15) score = Math.min(score, 55)
  const clamped = Math.max(0, Math.min(100, score))
  let band = 'Healthy'
  if (clamped < 50) band = 'At risk'
  else if (clamped < 80) band = 'Watch'
  return {
    score: clamped,
    band,
    breakdown: { lifespan: Math.round(lifespanScore), temperature: Math.round(tempScore), errors: Math.round(errorScore) }
  }
}

export function bandColor(band) {
  if (band === 'Healthy') return '#22c55e'
  if (band === 'Watch') return '#eab308'
  return '#ef4444'
}
