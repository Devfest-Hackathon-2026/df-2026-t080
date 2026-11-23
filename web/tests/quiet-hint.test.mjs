// 候補の一覧の「空いている時間帯」の一言が、旅の出発から帰りまでの時間だけで言われることの試験。実行: node --test web/tests/quiet-hint.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { quietHint, FIRST_HOUR } = await server.ssrLoadModule('/src/lib/crowd.ts')

// 8 時台から 18 時台まで、1 時間ごとの混雑（0〜4）。朝 8 時台と 18 時台が空いていて、昼は混む場所
const busyNoon = [1, 2, 3, 3, 4, 4, 3, 3, 2, 2, 1]
const spot = (crowd, open = 6 * 60, close = 21 * 60) => ({ id: 'p', name: 'p', kind: 'sight', open, close, crowd, weekdayDrop: 0 })
const at = (h) => busyNoon[h - FIRST_HOUR]

test('試験の前提: 8 時台と 18 時からが空いている', () => {
  assert.equal(FIRST_HOUR, 8)
  assert.equal(at(8), 1)
  assert.equal(at(17), 2)
  assert.equal(at(18), 1)
})

test('旅の時刻を渡さなければ、その場所の一日から言う（今までどおり）', () => {
  assert.equal(quietHint(spot(busyNoon), 'holiday'), '朝と18時から空いています')
})

test('10 時に出て 18 時に帰る旅には、朝と 18 時からを勧めない', () => {
  const hint = quietHint(spot(busyNoon), 'holiday', { start: 10 * 60, end: 18 * 60 })
  assert.equal(hint, '10時〜16時が混雑します')
})

test('帰りが遅い旅には、夕方から空くことを言う', () => {
  assert.equal(quietHint(spot(busyNoon), 'holiday', { start: 10 * 60, end: 20 * 60 }), '18時から空きます')
})

test('朝早く出る旅には、朝が空いていることを言う', () => {
  assert.equal(quietHint(spot(busyNoon), 'holiday', { start: 7 * 60 + 30, end: 15 * 60 }), '朝が空いています')
})

test('旅の間ずっと空いている場所は「一日空いています」', () => {
  assert.equal(quietHint(spot([3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3]), 'holiday', { start: 9 * 60, end: 18 * 60 }), '一日空いています')
})

test.after(() => server.close())
