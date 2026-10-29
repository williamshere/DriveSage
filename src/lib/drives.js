export function formatBytes(bytes){
  if(bytes==null) return '—'
  const u=['B','KB','MB','GB','TB']; let i=0; let v=bytes
  while(v>=1024 && i<u.length-1){ v/=1024; i++ }
  return `${v.toFixed(i===0?0:1)} ${u[i]}`
}
export function formatTemp(t){ return t==null ? 'unavailable' : `${t}°C` }

export function mockDrives(){
  // realistic mock for browser demo, mirrors what WMI would return
  return [
    { id:'nvme0', letter:'C:', model:'Samsung 980 PRO 1TB', serial:'S6C2NX0T123456', capacityBytes:1024*1024*1024*1000, freeBytes: 1024*1024*1024*340, temperature:42, wearPercent:8, reallocated:0, pending:0, crcErrors:1, powerOnHours:8120, type:'NVMe' },
    { id:'sata0', letter:'D:', model:'WD Blue 4TB', serial:'WD-WCC7K1234567', capacityBytes:4000*1024*1024*1024, freeBytes: 4000*1024*1024*1024*0.18, temperature:38, wearPercent:22, reallocated:2, pending:1, crcErrors:0, powerOnHours:23400, type:'HDD' },
    { id:'sata1', letter:'E:', model:'SanDisk Ultra 512GB', serial:'SD3239F123', capacityBytes:512*1024*1024*1024, freeBytes: 512*1024*1024*1024*0.62, temperature:31, wearPercent:4, reallocated:0, pending:0, crcErrors:0, powerOnHours:1200, type:'SSD' },
    { id:'usb0', letter:'F:', model:'External USB 2TB', serial:'USB-EX-9981', capacityBytes:2000*1024*1024*1024, freeBytes: 2000*1024*1024*1024*0.05, temperature:null, wearPercent:null, reallocated:null, pending:null, crcErrors:null, powerOnHours:null, type:'USB' },
  ]
}

export function mockFolderTree(){
  return {
    name:'C:', size: 660*1024*1024*1024, children:[
      { name:'Users', size:420*1024*1024*1024, children:[
        {name:'Media', size:180*1024*1024*1024, children:[{name:'4K Footage',size:110*1024*1024*1024},{name:'Photos',size:45*1024*1024*1024},{name:'Music',size:25*1024*1024*1024}]},
        {name:'Projects', size:95*1024*1024*1024, children:[{name:'node_modules',size:38*1024*1024*1024},{name:'archives',size:32*1024*1024*1024},{name:'builds',size:25*1024*1024*1024}]},
        {name:'AppData', size:85*1024*1024*1024},
        {name:'Documents', size:60*1024*1024*1024},
      ]},
      { name:'Games', size:180*1024*1024*1024, children:[{name:'CallOfDuty',size:95*1024*1024*1024},{name:'SteamLibrary',size:85*1024*1024*1024}]},
      { name:'Program Files', size:45*1024*1024*1024 },
      { name:'Temp', size:15*1024*1024*1024 },
    ]
  }
}

export function mockFiles(){
  const base=[
    {path:'C:\\Users\\Media\\4K Footage\\clip_001.mov', size: 4.2*1024*1024*1024, mtime: 1710000000000},
    {path:'C:\\Users\\Media\\4K Footage\\clip_001 - copy.mov', size: 4.2*1024*1024*1024, mtime: 1710001000000},
    {path:'C:\\Users\\Media\\4K Footage\\clip_002.mov', size: 3.8*1024*1024*1024, mtime: 1710002000000},
    {path:'C:\\Users\\Media\\4K Footage\\clip_002 - copy.mov', size: 3.8*1024*1024*1024, mtime: 1710003000000},
    {path:'C:\\Users\\Media\\Photos\\IMG_4829.CR2', size: 28*1024*1024, mtime: 1710100000000},
    {path:'C:\\Users\\Media\\Photos\\IMG_4829 - Copy.CR2', size: 28*1024*1024, mtime: 1710101000000},
    {path:'C:\\Users\\Media\\Photos\\IMG_4901.CR2', size: 31*1024*1024, mtime: 1710200000000},
    {path:'C:\\Users\\Projects\\builds\\installer.iso', size: 5.1*1024*1024*1024, mtime: 1710300000000},
    {path:'C:\\Users\\Projects\\archives\\backup_2023.zip', size: 6.4*1024*1024*1024, mtime: 1710400000000},
    {path:'C:\\Users\\Projects\\archives\\backup_2023 (1).zip', size: 6.4*1024*1024*1024, mtime: 1710401000000},
    {path:'D:\\Games\\CallOfDuty\\data.pack', size: 42*1024*1024*1024, mtime: 1710500000000},
    {path:'C:\\Windows\\Temp\\tmp_0192.tmp', size: 1.2*1024*1024*1024, mtime: 1710600000000},
    {path:'C:\\Users\\AppData\\Local\\Temp\\cache_772.tmp', size: 890*1024*1024, mtime: 1710601000000},
    {path:'C:\\Users\\AppData\\Local\\Temp\\thumbcache.db', size: 540*1024*1024, mtime: 1710602000000},
    {path:'$Recycle.Bin\\deleted_video.mov', size: 2.3*1024*1024*1024, mtime: 1710603000000},
    {path:'C:\\Users\\Media\\Music\\album_flac.zip', size: 1.1*1024*1024*1024, mtime: 1710700000000},
  ]
  // expand to 80 files
  const files=[...base]
  for(let i=0;i<64;i++){
    files.push({path:`C:\\Users\\Projects\\node_modules\\pkg_${i}\\index.js`, size: (Math.floor(Math.random()*900)+100)*1024, mtime: 1710800000000+i*1000})
  }
  return files
}

export function mockCleanupFiles(){
  return {
    winTemp: Array.from({length:42},(_,i)=>({path:`C:\\Windows\\Temp\\tmp_${i}.tmp`, size:(Math.floor(Math.random()*80)+5)*1024*1024})),
    userTemp: Array.from({length:88},(_,i)=>({path:`C:\\Users\\Willi\\AppData\\Local\\Temp\\cache_${i}.tmp`, size:(Math.floor(Math.random()*40)+2)*1024*1024})),
    recycleBin: Array.from({length:12},(_,i)=>({path:`$Recycle.Bin\\file_${i}.dat`, size:(Math.floor(Math.random()*500)+20)*1024*1024})),
    thumbCache: Array.from({length:6},(_,i)=>({path:`C:\\Users\\Willi\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache_${i}.db`, size:(Math.floor(Math.random()*300)+50)*1024*1024})),
    deliveryOpt: Array.from({length:9},(_,i)=>({path:`C:\\Windows\\ServiceProfiles\\NetworkService\\AppData\\Local\\DeliveryOptimization\\file_${i}.dat`, size:(Math.floor(Math.random()*600)+80)*1024*1024})),
  }
}

export function mockHistory(drives){
  // generate 14 days of temp + free history
  const now=Date.now()
  return drives.map(d=>{
    const temps= Array.from({length:14},(_,i)=> 30 + Math.round(Math.random()*18) + (d.id==='nvme0'?4:0))
    const frees= Array.from({length:10},(_,i)=>({ts: now - (9-i)*86400000, freeBytes: d.freeBytes + (9-i)*1.2*1024*1024*1024 - Math.random()*0.5*1024*1024*1024 }))
    return { driveId:d.id, temps, frees }
  })
}
