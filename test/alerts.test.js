import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkAlerts, shouldDebounce, recordAlert } from '../src/lib/alerts.js'

describe('alerts', ()=>{
  it('temperature warning', ()=>{
    const a=checkAlerts({letter:'C:', temperature:55}, {tempWarning:50,tempCritical:60,wearWarning:70,freeSpaceWarningPct:10})
    assert.ok(a.some(x=>x.type==='temperature'))
  })
  it('free space warning', ()=>{
    const a=checkAlerts({letter:'D:', capacityBytes:100, freeBytes:5}, {tempWarning:50,tempCritical:60,wearWarning:70,freeSpaceWarningPct:10})
    assert.ok(a.some(x=>x.type==='freeSpace'))
  })
  it('debounce 24h', ()=>{
    let log={}
    log=recordAlert(log,'d1','temperature', 1000)
    assert.equal(shouldDebounce(log,'d1','temperature', 1000+ 3600*1000), true)
    assert.equal(shouldDebounce(log,'d1','temperature', 1000+ 25*3600*1000), false)
  })
})
