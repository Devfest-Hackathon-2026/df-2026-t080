// 時刻表のあるエリアで、時刻表の表を先に返し、電車の路線が取れたら電車の目安の入った表を後から渡すことの試験。
// 実行: node --test web/tests/bus-table-rail.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage
window.setTimeout = (fn) => {
  queueMicrotask(fn)
  return 0
}

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { fetchBusTable } = await server.ssrLoadModule('/src/lib/busTable.ts')

const p = (id, lat, lng) => ({ id, name: id, lat, lng })
const data = (k) => ({ start: p('start', 34.7025, 135.4959 + k), end: null, places: [p('namba', 34.6661, 135.5001)] })
const opt = { line: '御堂筋線', color: 'E5171F', mode: 'subway', board: { name: '梅田', lat: 34.7, lng: 135.5 }, alight: { name: 'なんば', lat: 34.66, lng: 135.5 }, walkTo: 3, wait: 3, ride: 9, walkFrom: 2, stops: 4, path: [[135.5, 34.7], [135.5, 34.66]] }
const reply = (j) => ({ ok: true, json: async () => j })

function serve(replies) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body))
    return reply(replies[Math.min(calls.length - 1, replies.length - 1)])
  }
  return calls
}

test('時刻表の表を先に返し、電車が取れたら後から渡す', async () => {
  const calls = serve([
    { minutes: [[null, 31], [33, null]], sources: [], railLoading: true },
    { minutes: [[null, 31], [33, null]], sources: [], railLoading: true },
    { minutes: [[null, 31], [33, null]], sources: [], rail: { opts: [opt], via: [[null, null], [null, null]] } },
  ])
  let late = null
  const first = await fetchBusTable(data(0), '2026-11-21', 540, 1080, undefined, (t) => (late = t))
  assert.deepEqual(first.minutes, [[null, 31], [33, null]])
  assert.equal(first.rail, undefined)
  for (let i = 0; i < 50 && !late; i++) await new Promise((r) => setImmediate(r))
  assert.equal(calls.length, 3)
  assert.equal(late.rail.opts[0].color, 'E5171F')
  assert.deepEqual(late.minutes, [[null, 31], [33, null]])
  const again = await fetchBusTable(data(0), '2026-11-21', 540, 1080)
  assert.equal(again, late)
})

test('電車が取れなかったら、後からは何も渡さない', async () => {
  const calls = serve([
    { minutes: [[null, 31], [33, null]], sources: [], railLoading: true },
    { minutes: [[null, 31], [33, null]], sources: [] },
  ])
  let late = null
  const first = await fetchBusTable(data(0.001), '2026-11-21', 540, 1080, undefined, (t) => (late = t))
  assert.deepEqual(first.minutes, [[null, 31], [33, null]])
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r))
  assert.equal(calls.length, 2)
  assert.equal(late, null)
})

test('止めたら、電車を待つ聞き直しもやめる', async () => {
  const calls = serve([{ minutes: [[null, 31], [33, null]], sources: [], railLoading: true }])
  const stop = new AbortController()
  let late = null
  await fetchBusTable(data(0.002), '2026-11-21', 540, 1080, stop.signal, (t) => (late = t))
  stop.abort()
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r))
  assert.ok(calls.length <= 2)
  assert.equal(late, null)
})

test.after(() => server.close())
