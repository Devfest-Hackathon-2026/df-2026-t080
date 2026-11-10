// 水で歩く道が切れた 2 点が、徒歩にならないことの試験（#129）。実行: node --test web/tests/geo-cutoff.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const geo = await server.ssrLoadModule('/src/lib/geo.ts')

const p = (id, lat, lng) => ({ id, name: id, lat, lng })
// 鹿児島市内と桜島の湯之平展望所（湾をはさむ。直線で 約 6 km。直線の徒歩の見積もりは 100 分ほど）、市内の近い 2 点
const city = p('city', 31.5836, 130.5413)
const near = p('near', 31.5846, 130.5463)
const isle = p('isle', 31.5919, 130.6050)
const data = (walk, drive) => ({
  start: city,
  end: null,
  places: [near, isle],
  matrix: { ids: ['start', 'near', 'isle'], walk, drive, heights: [] },
})
const NIL = null

test('歩く道が無い遠い 2 点は、電車・バスにする', () => {
  const d = data(
    [[0, 5, NIL], [5, 0, NIL], [NIL, NIL, 0]],
    [[0, 3, 58], [3, 0, 58], [58, 58, 0]],
  )
  d.places = [near, isle]
  geo.setMatrix(d)
  const leg = geo.route(city, isle)
  assert.equal(leg.mode, 'transit')
})

test('歩く道の表がある 2 点は、これまでどおり徒歩', () => {
  const d = data(
    [[0, 5, 40], [5, 0, 40], [40, 40, 0]],
    [[0, 3, 10], [3, 0, 10], [10, 10, 0]],
  )
  geo.setMatrix(d)
  assert.equal(geo.route(city, isle).mode, 'walk')
})

test('歩く道が無くても近い 2 点は、直線の見積もりで徒歩', () => {
  const d = data(
    [[0, NIL, NIL], [NIL, 0, NIL], [NIL, NIL, 0]],
    [[0, 3, 58], [3, 0, 58], [58, 58, 0]],
  )
  geo.setMatrix(d)
  assert.equal(geo.route(city, near).mode, 'walk')
})

test('表が無いときは、これまでどおり（直線の見積もり）', () => {
  geo.setMatrix({ ...data([[0]], [[0]]), matrix: undefined })
  assert.equal(geo.route(city, near).mode, 'walk')
})

test.after(() => server.close())
