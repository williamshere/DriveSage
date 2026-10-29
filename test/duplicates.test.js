import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { findDuplicateGroups, largestFiles } from '../src/lib/duplicates.js'

describe('duplicates', ()=>{
  it('groups by size then hash', ()=>{
    const files=[
      {path:'a/file1.bin', size:100, mtime:1},
      {path:'b/file1.bin', size:100, mtime:2},
      {path:'c/other.bin', size:200, mtime:3},
    ]
    const {groups}=findDuplicateGroups(files)
    assert.ok(groups.length>=1)
  })
  it('largestFiles sorted', ()=>{
    const files=[{path:'a',size:10},{path:'b',size:300},{path:'c',size:20}]
    const r=largestFiles(files,2)
    assert.equal(r[0].size,300)
    assert.equal(r.length,2)
  })
})
