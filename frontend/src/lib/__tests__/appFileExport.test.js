import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appFileExportUrl, MAX_APP_EXPORT_BYTES, parseAppFileExport, readAppFileExport,
} from '../appFileExport.js'

test('file export accepts only a bounded relative own-file path and safe name', () => {
  const message = { type: 'moebius:file-export', requestId: 'r1', path: 'library/files/abc.mp3', name: 'Artist / Track.mp3' }
  assert.deepEqual(parseAppFileExport(message), {
    requestId: 'r1', path: 'library/files/abc.mp3', name: 'Artist _ Track.mp3',
  })
  for (const path of ['../secret', '/absolute', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'a\u0000b']) {
    assert.equal(parseAppFileExport({ ...message, path }), null, path)
  }
  assert.equal(appFileExportUrl(12, 'library/files/a b.mp3'), '/api/storage/apps/12/library/files/a%20b.mp3')
  assert.equal(parseAppFileExport({ ...message, name: 'song\u202Emp3.exe' }).name, 'song_mp3.exe')
  assert.equal(parseAppFileExport({ ...message, name: 'song\u2067safe\u2069.exe' }).name, 'song_safe_.exe')
})

test('file export reads only the host-selected app with the scoped bearer', async () => {
  const calls = []
  const blob = await readAppFileExport({
    appId: 12, path: 'library/files/abc.mp3', token: 'scoped',
    fetchFile: async (...args) => {
      calls.push(args)
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } })
    },
  })
  assert.equal(blob.type, 'audio/mpeg')
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3])
  assert.equal(calls[0][0], '/api/storage/apps/12/library/files/abc.mp3')
  assert.equal(calls[0][1].headers.Authorization, 'Bearer scoped')
})

test('file export rejects a declared oversized response before reading it', async () => {
  await assert.rejects(readAppFileExport({
    appId: 12, path: 'big.mp3', token: 'scoped',
    fetchFile: async () => new Response('x', { headers: { 'content-length': String(MAX_APP_EXPORT_BYTES + 1) } }),
  }), /too large/)
})

test('file export aborts an active stream instead of retaining its chunks', async () => {
  const controller = new AbortController()
  let cancelled = false
  let reading
  const readingStarted = new Promise(resolve => { reading = resolve })
  const stream = new ReadableStream({
    pull(source) {
      source.enqueue(new Uint8Array([1, 2, 3]))
      reading()
      return new Promise(() => {})
    },
    cancel() { cancelled = true },
  })
  const pending = readAppFileExport({
    appId: 12, path: 'large.mp3', token: 'scoped', signal: controller.signal,
    fetchFile: async (_url, options) => {
      assert.equal(options.signal, controller.signal)
      return new Response(stream)
    },
  })
  await readingStarted
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancelled, true)
})

test('file export does not begin fetching after cancellation', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(readAppFileExport({
    appId: 12, path: 'song.mp3', token: 'scoped', signal: controller.signal,
    fetchFile: () => { throw new Error('fetch must not run') },
  }), { name: 'AbortError' })
})
