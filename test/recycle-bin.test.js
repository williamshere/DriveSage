import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
const available = !spawnSync(shell, ['-NoProfile', '-Command', 'exit 0']).error
const source = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8')
const script = source.match(/const RECYCLE_BIN_SCRIPT: &str = r#"([\s\S]*?)"#;/)[1]
  .replace('[System.IO.DriveInfo]::GetDrives()', '$fakeDrives')

function measure(scenario) {
  const mocks = `
$scenario = '${scenario}'
$fakeDrives = @(
  [pscustomobject]@{Name='A:\\'; DriveType='Fixed'; IsReady=$true},
  [pscustomobject]@{Name='B:\\'; DriveType='Fixed'; IsReady=$true},
  [pscustomobject]@{Name='C:\\'; DriveType='Fixed'; IsReady=$true}
)
function Test-Path {
  param($LiteralPath, $ErrorAction)
  if ($scenario -eq 'probe-error' -and $LiteralPath.StartsWith('B:')) { throw 'access denied' }
  return -not $LiteralPath.StartsWith('C:')
}
function Get-ChildItem {
  param($LiteralPath, [switch]$Recurse, [switch]$Force, [switch]$File, $ErrorAction)
  if ($LiteralPath.StartsWith('A:')) { return @([pscustomobject]@{Length=7}, [pscustomobject]@{Length=11}) }
  if ($scenario -eq 'enumeration-error') { throw 'read error' }
  if ($scenario -eq 'empty') { return }
  return [pscustomobject]@{Length=13}
}
`
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', mocks + script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

it('streams and totals each accessible Recycle Bin, including empty and missing bins', { skip: !available }, () => {
  assert.deepEqual(measure('normal'), { Count: 3, Sum: 31 })
  assert.deepEqual(measure('empty'), { Count: 2, Sum: 18 })
})

it('discards partial totals after probe or enumeration errors', { skip: !available }, () => {
  assert.equal(measure('probe-error'), null)
  assert.equal(measure('enumeration-error'), null)
})
