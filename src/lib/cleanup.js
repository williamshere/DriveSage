// Cleanup categories - allowlisted only
export const CLEANUP_CATEGORIES = [
  { id:'winTemp', label:'Windows Temp', paths:['C:\\Windows\\Temp'], desc:'System temp files' },
  { id:'userTemp', label:'User Temp', paths:['%TEMP%'], desc:'Per-user temp files' },
  { id:'recycleBin', label:'Recycle Bin', paths:['$Recycle.Bin'], desc:'Files in Recycle Bin' },
  { id:'thumbCache', label:'Thumbnail Cache', paths:['Thumbs.db','ehthumbs.db'], desc:'Cached thumbnails' },
  { id:'deliveryOpt', label:'Delivery Optimization', paths:['DeliveryOptimization'], desc:'Update cache files' },
]

export const PROTECTED_PREFIXES = ['C:\\Windows','C:\\Program Files','C:\\Program Files (x86)']
export const PROTECTED_USER_FOLDERS = ['Documents','Pictures','Desktop','Downloads']

export function isProtectedPath(p, exclusions=[]){
  const norm = p.replace(/\//g,'\\')
  for(const ex of exclusions) if(norm.toLowerCase().startsWith(ex.toLowerCase())) return false // user explicitly allowed
  for(const pre of PROTECTED_PREFIXES) if(norm.toLowerCase().startsWith(pre.toLowerCase())) return true
  // check user folders
  for(const uf of PROTECTED_USER_FOLDERS){
    if(norm.includes('\\'+uf+'\\') || norm.endsWith('\\'+uf)) return true
  }
  return false
}

export function buildPreview(filesByCategory, enabledIds){
  const preview=[]
  let totalBytes=0, totalCount=0
  for(const cat of CLEANUP_CATEGORIES){
    if(!enabledIds.includes(cat.id)) continue
    const files = filesByCategory[cat.id] || []
    const bytes = files.reduce((a,b)=>a+b.size,0)
    preview.push({ category:cat, files, count:files.length, bytes })
    totalBytes+=bytes; totalCount+=files.length
  }
  return { items:preview, totalBytes, totalCount }
}

export function filterAllowedDeletions(previewItems, exclusions=[]){
  // Enforce safety: never delete protected unless explicitly excluded (i.e., user added path => exclusions contains it)
  const safe=[]
  for(const item of previewItems){
    const filtered = item.files.filter(f=> !isProtectedPath(f.path, exclusions))
    safe.push({ ...item, files: filtered, count: filtered.length, bytes: filtered.reduce((a,b)=>a+b.size,0) })
  }
  return safe
}
