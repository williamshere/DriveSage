import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildDriveRecommendation, summarizeSystemStatus } from '../src/lib/recommendations.js'

describe('recommendations', () => {
  it('flags a high-risk drive', () => {
    const result = buildDriveRecommendation(
      { id: 'd1', letter: 'D:', model: 'Seagate 4TB', temperature: 62, wearPercent: 82, reallocated: 5, pending: 2, crcErrors: 1, capacityBytes: 1000, freeBytes: 30 },
      { temps: [44, 50, 62] },
      { tempWarning: 50, tempCritical: 60, wearWarning: 70, freeSpaceWarning: 10 }
    )

    assert.ok(result.recommendations.some((r) => r.title.includes('Backup') || r.title.includes('Cool')))
    assert.equal(result.health.band, 'At risk')
  })

  it('summarizes the system with the worst drive', () => {
    const summary = summarizeSystemStatus(
      [
        { id: 'a', letter: 'C:', model: 'Healthy SSD', temperature: 35, wearPercent: 5, reallocated: 0, pending: 0, crcErrors: 0, capacityBytes: 1000, freeBytes: 200 },
        { id: 'b', letter: 'D:', model: 'Risky HDD', temperature: 65, wearPercent: 81, reallocated: 4, pending: 2, crcErrors: 0, capacityBytes: 1000, freeBytes: 50 },
      ],
      [{ driveId: 'a', temps: [30, 32, 33] }, { driveId: 'b', temps: [45, 50, 65] }],
      { tempWarning: 50, tempCritical: 60, wearWarning: 70, freeSpaceWarning: 10 }
    )

    assert.equal(summary.status, 'At risk')
    assert.equal(summary.worstDrive.letter, 'D:')
    assert.ok(summary.recommendations.length >= 1)
  })
})
