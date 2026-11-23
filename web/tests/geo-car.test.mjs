// 車で回る旅の区間の決め方の試験。実行: node --test web/tests/geo-car.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const geo = await server.ssrLoadModule('/src/lib/geo.ts')

const p = (id, lat, lng) => ({ id, name: id, lat, lng })
// 那覇の 3 点（近い 2 点と、遠い 1 点）
const home = p('home', 26.2124, 127.6792)
const near = p('near', 26.2150, 127.6830)
const far = p('far', 26.3344, 127.8057)
const NIL = null
const data = (walk, drive) => ({ start: home, end: null, places: [near, far], matrix: { ids: ['start', 'near', 'far'], walk, drive, heights: [] } })
const table = () =>
  data(
    [[0, 8, 200], [8, 0, 195], [200, 195, 0]],
    [[0, 3, 30], [3, 0, 29], [30, 29, 0]],
  )

const setup = (d, car, modes = {}) => {
  geo.setMatrix(d)
  geo.setModes(d, modes)
  geo.setOverrides(d, {})
  geo.setBusTable(d, null)
  geo.setCar(car)
}

test('車の旅: 歩いて 10 分以内は徒歩', () => {
  setup(table(), true)
  const leg = geo.route(home, near)
  assert.equal(leg.mode, 'walk')
  assert.equal(leg.minutes, 8)
  assert.equal(leg.other, 3 + geo.PARK_MIN)
})

test('車の旅: 遠い区間は車で、道の表の時間に停める手間を足す', () => {
  setup(table(), true)
  const leg = geo.route(home, far)
  assert.equal(leg.mode, 'car')
  assert.equal(leg.minutes, 30 + geo.PARK_MIN)
  assert.equal(leg.label, `車 ${30 + geo.PARK_MIN}分`)
  assert.equal(leg.other, 200)
  assert.equal(leg.rail, undefined)
  assert.ok(geo.mapsDirUrl(leg).includes('travelmode=driving'))
  assert.ok(geo.mapsAppDirUrl(leg).includes('directionsmode=driving'))
})

test('車の旅: 1 時間を超える区間は、時間と分で書く', () => {
  setup(data([[0, 8, 1400], [8, 0, 1395], [1400, 1395, 0]], [[0, 3, 112], [3, 0, 111], [112, 111, 0]]), true)
  const leg = geo.route(home, far)
  assert.equal(leg.minutes, 112 + geo.PARK_MIN)
  assert.equal(leg.label, '車 1時間59分')
})

test('車の旅: 道の表に車の時間が無い区間は、直線の距離からの目安', () => {
  const d = table()
  d.matrix.drive = [[0, 3, NIL], [3, 0, NIL], [NIL, NIL, 0]]
  setup(d, true)
  const km = geo.distM(home, far) / 1000
  const leg = geo.route(home, far)
  assert.equal(leg.mode, 'car')
  assert.equal(leg.minutes, geo.driveEstimate(km) + geo.PARK_MIN)
})

test('車の目安: 遠いほど長く、10 km から先は 1 km あたりが短い', () => {
  assert.ok(geo.driveEstimate(5) < geo.driveEstimate(20))
  assert.equal(geo.driveEstimate(0), 1)
  const a = geo.driveEstimate(20) - geo.driveEstimate(10)
  const b = geo.driveEstimate(5) - geo.driveEstimate(0)
  assert.ok(a / 10 < b / 5)
})

test('車の旅: 区間ごとに徒歩と車を選べる（電車・バスを選んでいた区間は車）', () => {
  setup(table(), true, { 'start>near': 'car', 'start>far': 'walk' })
  const a = geo.route(home, near)
  assert.equal(a.mode, 'car')
  assert.equal(a.chosen, true)
  const b = geo.route(home, far)
  assert.equal(b.mode, 'walk')
  assert.equal(b.chosen, true)
  setup(table(), true, { 'start>near': 'transit' })
  assert.equal(geo.route(home, near).mode, 'car')
})

test('車の旅でない旅は、これまでどおり（車を選んでいた区間は電車・バス）', () => {
  setup(table(), false)
  assert.equal(geo.route(home, far).mode, 'transit')
  assert.equal(geo.route(home, near).mode, 'walk')
  setup(table(), false, { 'start>near': 'car' })
  assert.equal(geo.route(home, near).mode, 'transit')
})

test('車の旅は、時刻表の目安と入れた経路を使わない', () => {
  const d = table()
  setup(d, true)
  geo.setBusTable(d, { ids: ['start', 'near', 'far'], minutes: [[NIL, 5, 12], [5, NIL, 12], [12, 12, NIL]] })
  geo.setOverrides(d, { 'start>far': { minutes: 15, steps: [{ mode: 'train', line: 'ゆいレール', minutes: 15 }] } })
  const leg = geo.route(home, far)
  assert.equal(leg.mode, 'car')
  assert.equal(leg.real, undefined)
  assert.equal(leg.minutes, 30 + geo.PARK_MIN)
})

test.after(() => {
  geo.setCar(false)
  return server.close()
})
