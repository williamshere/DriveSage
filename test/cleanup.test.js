import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isProtectedPath, buildPreview } from '../src/lib/cleanup.js'

describe('cleanup safety', ()=>{
  it('protects Windows', ()=>{
    assert.equal(isProtectedPath('C:\\Windows\\Temp\\foo.tmp'), true)
    assert.equal(isProtectedPath('C:\\Program Files\\app\\x.exe'), true)
  })
  it('allows explicitly excluded path', ()=>{
    assert.equal(isProtectedPath('C:\\Windows\\Temp\\foo.tmp', ['C:\\Windows\\Temp']), false)
  })
  it('protects user Documents', ()=>{
    assert.equal(isProtectedPath('C:\\Users\\Willi\\Documents\\secret.docx'), true)
  })
  it('preview counts', ()=>{
    const filesByCat={ winTemp:[{path:'a',size:100},{path:'b',size:200}] }
    const p=buildPreview(filesByCat, ['winTemp'])
    assert.equal(p.totalCount,2)
    assert.equal(p.totalBytes,300)
  })
})
