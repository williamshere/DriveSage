import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
const available = !spawnSync(shell, ['-NoProfile', '-Command', 'exit 0']).error

it('uses storage associations only for uniquely backed volumes', { skip: !available }, () => {
  const source = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8')
  const script = source.match(/const DRIVE_SCRIPT: &str = r#"([\s\S]*?)"#;/)[1]
    .replace('[System.IO.DriveInfo]::GetDrives()', '$fakeDrives')
  const mocks = `
$fakeDrives = @('C','D','E','F','G','H','I','J') | ForEach-Object {
  [pscustomobject]@{ Name="$($_):\\"; DriveType='Fixed'; IsReady=$true; TotalSize=100; AvailableFreeSpace=40 }
}
function Get-Partition($DriveLetter) {
  if ($DriveLetter -eq 'J') { return @(@{ letter='J' }, @{ letter='J' }) }
  return @{ letter=$DriveLetter; DiskNumber=99 }
}
function Get-Disk($Partition) { return @{ letter=$Partition.letter; kind='disk' } }
function Get-CimAssociatedInstance($InputObject, $ResultClassName, $Namespace) {
  if ($Namespace -ne 'root/Microsoft/Windows/Storage') { throw 'wrong namespace' }
  $letter = $InputObject.letter
  if ($letter -eq 'H') { throw 'association failed' }
  if ($ResultClassName -eq 'MSFT_VirtualDisk') {
    if ($letter -in @('E','F')) { return @{ letter=$letter; kind='virtual' } }
  } elseif ($ResultClassName -eq 'MSFT_StorageReliabilityCounter') {
    if ($letter -eq 'D') { return @{ letter=$letter; kind='counter' } }
  } elseif ($ResultClassName -eq 'MSFT_PhysicalDisk') {
    if ($letter -eq 'I') { return @(@{ FriendlyName='one' }, @{ FriendlyName='two' }) }
    if ($letter -eq 'C' -or ($letter -eq 'D' -and $InputObject.kind -eq 'counter')) {
      return @{ FriendlyName="physical-$letter"; DeviceId=1; BusType='SATA' }
    }
  }
}
function Get-PhysicalDisk($VirtualDisk) {
  if ($VirtualDisk.letter -eq 'E') { return @(@{ FriendlyName='one' }, @{ FriendlyName='two' }) }
  return @{ FriendlyName='physical-F'; DeviceId=2; BusType='NVMe' }
}
function Get-StorageReliabilityCounter {
  process { return @{ Temperature=42; Wear=5; PowerOnHours=100 } }
}
`
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', mocks + script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const rows = JSON.parse(result.stdout)
  assert.deepEqual(rows.map(row => row.disk?.model ?? null),
    ['physical-C', 'physical-D', null, 'physical-F', null, null, null, null])
  assert.equal(rows[0].disk.temp, 42)
  assert.equal(rows[1].disk.wear, 5)
  assert.equal(rows[3].disk.bus, 'NVMe')
})
