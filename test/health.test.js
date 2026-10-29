import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeHealth } from '../src/lib/health.js'

describe('health scoring', ()=>{
  it('healthy drive near 100', ()=>{
    const r=computeHealth({wearPercent:2, tempHistory:[32,33,34], maxTemp:34, reallocated:0, pending:0, crcErrors:0})
    assert.ok(r.score>=80)
    assert.equal(r.band,'Healthy')
  })
  it('worn drive degrades', ()=>{
    const r=computeHealth({wearPercent:85, tempHistory:[32,33], maxTemp:33, reallocated:0, pending:0, crcErrors:0})
    assert.ok(r.score<60)
  })
  it('hot drive penalized', ()=>{
    const r=computeHealth({wearPercent:5, tempHistory:[52,55,58,55,52], maxTemp:58, warningTemp:50, reallocated:0, pending:0, crcErrors:0})
    assert.ok(r.breakdown.temperature < 70)
  })
  it('error heavy penalized', ()=>{
    const r=computeHealth({wearPercent:5, tempHistory:[30], maxTemp:30, reallocated:10, pending:5, crcErrors:3})
    assert.ok(r.breakdown.errors < 50)
    assert.ok(r.score < 70)
  })
  it('bands correct boundaries', ()=>{
    assert.equal(computeHealth({wearPercent:0, tempHistory:[30], maxTemp:30, reallocated:0, pending:0, crcErrors:0}).band,'Healthy')
  })
})
