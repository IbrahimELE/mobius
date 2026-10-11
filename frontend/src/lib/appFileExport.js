// A visible app may ask the shell to export one of its own stored files. The
// app id and bearer come from AppCanvas, never from the message payload.
export const MAX_APP_EXPORT_BYTES = 100 * 1024 * 1024

export function parseAppFileExport(message) {
  if (message?.type !== 'moebius:file-export') return null
  const requestId = message.requestId
  const path = message.path
  if (typeof requestId !== 'string' || !requestId || requestId.length > 160) return null
  if (typeof path !== 'string' || !path || path.length > 512) return null
  const parts = path.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\\u0000-\u001f\u007f]/.test(part))) return null
  const suggested = typeof message.name === 'string' ? message.name : parts.at(-1)
  const name = suggested.replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g, '_').trim().slice(0, 180)
  if (!name) return null
  return { requestId, path, name }
}

export function appFileExportUrl(appId, path) {
  return `/api/storage/apps/${encodeURIComponent(appId)}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export async function readAppFileExport({ appId, path, token, fetchFile = fetch }) {
  if (!token) throw new Error('App session is unavailable.')
  const response = await fetchFile(appFileExportUrl(appId, path), {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  })
  if (!response.ok) throw new Error(`File could not be read (${response.status}).`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_APP_EXPORT_BYTES) {
    await response.body?.cancel?.()
    throw new Error('This file is too large to export from the browser (100 MB limit).')
  }
  if (!response.body) throw new Error('File streaming is unavailable.')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_APP_EXPORT_BYTES) {
        await reader.cancel()
        throw new Error('This file is too large to export from the browser (100 MB limit).')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' })
}

export function saveAppFileExport(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.style.display = 'none'
  document.body.append(link)
  try { link.click() } finally {
    link.remove()
    // Revoke only after the browser has taken the download URL.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
