import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { estimateDaysUntilFull } from '../src/lib/forecast.js'

describe('forecast', ()=>{
  it('insufficient history <7', ()=>{
    const r=estimateDaysUntilFull([{ts:Date.now(), freeBytes:1000},{ts:Date.now()+1000, freeBytes:900}])
    assert.equal(r.days, null)
  })
  it('decreasing free predicts days', ()=>{
    const now=Date.now()
    const hist=Array.from({length:10},(_,i)=>({ts: now - (9-i)*86400000, freeBytes: 100*1024*1024*1024 - i*2*1024*1024*1024}))
    const r=estimateDaysUntilFull(hist)
    assert.ok(r.days>0 && r.days<100)
  })
  it('increasing free = Infinity', ()=>{
    const now=Date.now()
    const hist=Array.from({length:8},(_,i)=>({ts: now - (7-i)*86400000, freeBytes: 10*1024*1024*1024 + i*1024*1024*1024}))
    const r=estimateDaysUntilFull(hist)
    assert.equal(r.days, Infinity)
  })
})
