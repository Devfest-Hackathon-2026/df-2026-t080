// 例のプラン（京都のデモ）を、見ただけなら自分の旅に残さず、手を入れたら残す試験。実行: node --test web/tests/demo-shelf.test.mjs
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const mem = new Map()
const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window ??= { localStorage: store, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true, location: { search: '', href: 'http://localhost/' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage
globalThis.Event ??= class Event {
  constructor(type) {
    this.type = type
  }
}

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const T = await server.ssrLoadModule('/src/lib/trips.ts')
const S = await server.ssrLoadModule('/src/lib/saved.ts')
const W = await server.ssrLoadModule('/src/lib/why.ts')

const kyoto = { text: '京都駅', name: '京都駅', lat: 34.98, lng: 135.75 }
const plan = (since, extra = {}, demo = true) => ({
  data: { area: { name: '京都', lat: 35, lng: 135.76 }, start: kyoto, places: [{ id: 'a', name: '清水寺', lat: 35, lng: 135.78 }], conditions: [], query: { area: '京都駅', wish: '', start: kyoto, end: null }, ...(demo && { demo: true }) },
  areaText: '京都駅',
  wish: '',
  conds: [],
  condsTouched: false,
  date: '2026-11-21',
  start: 450,
  end: 900,
  must: ['a'],
  pinned: [],
  banned: [],
  overrides: {},
  stayFix: {},
  focus: [],
  skipDistricts: [],
  base: null,
  since,
  ...extra,
})

beforeEach(() => mem.clear())

test('例のプランを見ただけなら、ほかの旅を作っても棚に残らない', () => {
  assert.ok(S.writeSaved(plan(100)))
  assert.equal(T.untouchedDemo(plan(100)), true)
  assert.equal(T.tripFromDevice(), null)
  assert.equal(T.currentTripId(), null)
  assert.ok(S.writeSaved(plan(200, {}, false)))
  assert.deepEqual(T.readShelf(), [])
})

test('手を入れた例のプランは、ほかの旅を作ると棚に残る', () => {
  assert.ok(S.writeSaved(plan(100, { edited: true })))
  assert.equal(T.untouchedDemo(plan(100, { edited: true })), false)
  assert.equal(T.tripFromDevice()?.id, 'example-ja')
  assert.equal(T.currentTripId(), 'example-ja')
  assert.ok(S.writeSaved(plan(200, {}, false)))
  assert.deepEqual(T.readShelf().map((t) => t.id), ['example-ja'])
})

test('この旅で理由を書いた例のプランは、手を入れたものとして残す', () => {
  W.writeTrip('京都', { items: [{ spotId: 'a', spotName: '清水寺', chips: ['行ってみたかった'], text: '', downsideSeen: '', at: 150 }] })
  assert.equal(T.untouchedDemo(plan(100)), false)
  assert.equal(T.untouchedDemo(plan(200)), true)
})

test('手を入れた例のプランは、もう一度例を開いても 1 件だけ棚に残る', () => {
  assert.ok(S.writeSaved(plan(100, { edited: true })))
  assert.ok(S.writeSaved(plan(200)))
  assert.deepEqual(T.readShelf().map((t) => t.id), ['example-ja'])
  assert.ok(S.writeSaved(plan(200, { edited: true })))
  assert.ok(S.writeSaved(plan(300, {}, false)))
  const shelf = T.readShelf()
  assert.deepEqual(shelf.map((t) => t.id), ['example-ja'])
  assert.equal(shelf[0].since, 200)
})

test('自分で作った旅は、今までどおり棚に残る', () => {
  assert.ok(S.writeSaved(plan(100, {}, false)))
  assert.ok(S.writeSaved(plan(200, {}, false)))
  assert.equal(T.readShelf().length, 1)
})

test.after(() => server.close())
