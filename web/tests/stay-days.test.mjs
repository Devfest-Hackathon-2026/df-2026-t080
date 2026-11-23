// 泊まる宿を入れた旅の、日ごとの出発地と到着地の試験。実行: node --test web/tests/stay-days.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const D = await server.ssrLoadModule('/src/lib/days.ts')

const kyoto = { text: '京都駅', name: '京都駅', lat: 34.9858, lng: 135.7588 }
const inn = { text: '四条の宿', name: '四条の宿', lat: 35.0037, lng: 135.7681 }
const arashi = { text: '嵐山駅', name: '嵐山駅', lat: 35.0142, lng: 135.6776 }
const day = (date, start, end, extra = {}) => ({
  data: { area: { name: '京都' }, start, ...(end && { end }), places: [{ id: date, name: date, lat: 35, lng: 135.7 }], query: { area: '京都駅', wish: '', start, end } },
  areaText: start.text,
  wish: '',
  date,
  start: 600,
  end: 1080,
  shown: [{ id: date, slot: 'sight' }],
  base: null,
  since: 1,
  ...extra,
})

const inn2 = { text: '嵐山の宿', name: '嵐山の宿', lat: 35.0150, lng: 135.6800 }
const inn3 = { text: '岡崎の宿', name: '岡崎の宿', lat: 35.0130, lng: 135.7830 }

test('毎晩同じ宿: 1日目は宿まで・中の日は宿から宿へ・最終日は宿から最後の場所まで', () => {
  assert.deepEqual(D.stayTrip(1, 3, kyoto, [inn], null), { start: kyoto, end: inn })
  assert.deepEqual(D.stayTrip(2, 3, kyoto, [inn], null), { start: inn, end: null })
  assert.deepEqual(D.stayTrip(3, 3, kyoto, [inn], null), { start: inn, end: kyoto })
  assert.deepEqual(D.stayTrip(3, 3, kyoto, [inn], arashi), { start: inn, end: arashi })
  assert.deepEqual(D.stayTrip(2, 2, kyoto, [inn], arashi), { start: inn, end: arashi })
})

test('毎晩違う宿: 前の泊の宿から次の泊の宿へ', () => {
  const st = [inn, inn2, inn3]
  assert.deepEqual(D.stayTrip(1, 4, kyoto, st, null), { start: kyoto, end: inn })
  assert.deepEqual(D.stayTrip(2, 4, kyoto, st, null), { start: inn, end: inn2 })
  assert.deepEqual(D.stayTrip(3, 4, kyoto, st, null), { start: inn2, end: inn3 })
  assert.deepEqual(D.stayTrip(4, 4, kyoto, st, null), { start: inn3, end: kyoto })
})

test('途中の泊が空なら、前の泊と同じ宿', () => {
  const st = [inn, null, inn3]
  assert.equal(D.nightStay(st, 1), inn)
  assert.deepEqual(D.stayTrip(2, 4, kyoto, st, null), { start: inn, end: null })
  assert.deepEqual(D.stayTrip(3, 4, kyoto, st, null), { start: inn, end: inn3 })
  assert.deepEqual(D.stayTrip(4, 4, kyoto, st, null), { start: inn3, end: kyoto })
})

test('1泊目が空なら、その泊は宿なし（前の日の終わりの場所から）', () => {
  const st = [null, inn2]
  assert.equal(D.nightStay(st, 0), null)
  assert.deepEqual(D.stayTrip(1, 3, kyoto, st, null), { start: kyoto, end: null })
  assert.deepEqual(D.stayTrip(2, 3, kyoto, st, null, kyoto), { start: kyoto, end: inn2 })
  assert.deepEqual(D.stayTrip(3, 3, kyoto, st, null), { start: inn2, end: kyoto })
})

test('宿が無いか、日帰りなら決めない（今までどおり）', () => {
  assert.equal(D.stayTrip(2, 3, kyoto, [], null), null)
  assert.equal(D.stayTrip(2, 3, kyoto, [null, null], null), null)
  assert.equal(D.stayTrip(2, 3, kyoto, undefined, null), null)
  assert.equal(D.stayTrip(1, 1, kyoto, [inn], null), null)
})

test('次の日の頼み: 2泊3日の 2日目は宿から宿へ、3日目は宿から 1日目の出発地へ', () => {
  const d1 = { ...day('2026-11-21', kyoto, inn), planDays: 3, stays: [inn], tripEnd: null }
  assert.deepEqual(D.addDayAsk(d1), { start: inn, end: null })
  const two = D.addDay(d1, day('2026-11-22', inn, null))
  assert.deepEqual(two.stays, [inn])
  assert.equal(two.tripEnd, null)
  assert.equal(two.days.find((d) => d)?.stays, undefined)
  assert.deepEqual(D.addDayAsk(two), { start: inn, end: kyoto })
})

test('次の日の頼み: 1泊目と 2泊目で違う宿', () => {
  const d1 = { ...day('2026-11-21', kyoto, inn), planDays: 3, stays: [inn, inn2], tripEnd: null }
  assert.deepEqual(D.addDayAsk(d1), { start: inn, end: inn2 })
  const two = D.addDay(d1, day('2026-11-22', inn, inn2))
  assert.deepEqual(D.addDayAsk(two), { start: inn2, end: kyoto })
})

test('片道の旅は、最終日に最後に観光を終える場所へ', () => {
  const d1 = { ...day('2026-11-21', kyoto, inn), planDays: 2, stays: [inn], tripEnd: arashi }
  assert.deepEqual(D.addDayAsk(d1), { start: inn, end: arashi })
})

test('予定の日数より多く加えると、その日を最終日にする', () => {
  const d1 = { ...day('2026-11-21', kyoto, inn), stays: [inn], tripEnd: null }
  assert.deepEqual(D.addDayAsk(d1), { start: inn, end: kyoto })
})

test('宿が無い旅は、前の日の終わりの場所から（今までどおり）', () => {
  const d1 = { ...day('2026-11-21', kyoto, arashi), planDays: 3 }
  assert.deepEqual(D.addDayAsk(d1), { start: arashi, end: null })
  const back = { ...day('2026-11-21', kyoto, null), planDays: 3 }
  assert.deepEqual(D.addDayAsk(back), { start: kyoto, end: null })
})

test('あとから宿を入れると、1日目の到着地を最後に観光を終える場所として覚える', () => {
  const d1 = { ...day('2026-11-21', kyoto, arashi), planDays: 3 }
  const s = D.withStays(d1, [null, inn])
  assert.deepEqual(s.stays, [null, inn])
  assert.equal(s.tripEnd, arashi)
  assert.deepEqual(D.addDayAsk(s), { start: arashi, end: inn })
  const changed = D.withStays(s, [null, inn2])
  assert.equal(changed.tripEnd, arashi)
  const off = D.withStays(s, [null, null])
  assert.equal(off.stays, undefined)
  assert.deepEqual(D.addDayAsk(off), { start: arashi, end: null })
})

test('宿に入れ替えたあとも、1日目の到着地（前の宿）を最後の場所にしない', () => {
  const d1 = { ...day('2026-11-21', kyoto, inn), planDays: 3, stays: [inn], tripEnd: null }
  assert.equal(D.withStays(d1, [inn, inn2]).tripEnd, null)
  const old = { ...day('2026-11-21', kyoto, inn), planDays: 3, stays: [inn] }
  assert.equal(D.tripGoal(old), null)
})

test('後ろの空きは落とす', () => {
  assert.deepEqual(D.trimStays([inn, null, null]), [inn])
  assert.deepEqual(D.trimStays([null, inn, null]), [null, inn])
})

test('日の出発地・到着地が宿か', () => {
  assert.deepEqual(D.stayEnds(day('a', kyoto, inn), [inn]), { from: false, to: true })
  assert.deepEqual(D.stayEnds(day('a', inn, null), [inn]), { from: true, to: true })
  assert.deepEqual(D.stayEnds(day('a', inn, kyoto), [inn]), { from: true, to: false })
  assert.deepEqual(D.stayEnds(day('a', inn, inn2), [inn, inn2]), { from: true, to: true })
  assert.deepEqual(D.stayEnds(day('a', kyoto, null), [inn]), { from: false, to: false })
  assert.deepEqual(D.stayEnds(day('a', inn, null), []), { from: false, to: false })
  const demo = day('a', inn, null)
  demo.data.demo = true
  assert.deepEqual(D.stayEnds(demo, [inn]), { from: false, to: false })
})

test('日を入れ替え・削除・日数の変更をしても、宿は旅に 1 組残る', () => {
  const d1 = { ...day('2026-11-21', kyoto, inn), planDays: 3, stays: [inn, inn2], tripEnd: null }
  const two = D.addDay(d1, day('2026-11-22', inn, inn2))
  const back = D.switchDay(two, 0)
  assert.deepEqual(back.stays, [inn, inn2])
  assert.equal(back.tripEnd, null)
  assert.ok(back.days.every((d) => d === null || d.stays === undefined))
  assert.deepEqual(D.setPlannedDays(two, 4).stays, [inn, inn2])
  assert.deepEqual(D.removeDay(two).stays, [inn, inn2])
})

test('日を削除したら、その日の希望と時刻も抜いて詰める', () => {
  const wants = { wish: '寺', days: [{ start: 540 }, { wish: '嵐山' }, { end: 1020 }] }
  const d1 = { ...day('2026-11-21', kyoto, inn), planDays: 3, stays: [inn], wants }
  const two = D.addDay(d1, day('2026-11-22', inn, null))
  const three = D.addDay(two, day('2026-11-23', inn, kyoto))
  const mid = D.removeDay(D.switchDay(three, 1))
  assert.deepEqual(mid.wants, { wish: '寺', days: [{ start: 540 }, { end: 1020 }] })
  assert.equal(D.allDays(mid).length, 2)
  const first = D.removeDay(D.switchDay(three, 0))
  assert.deepEqual(first.wants.days, [{ wish: '嵐山' }, { end: 1020 }])
  assert.deepEqual(D.removeDay(D.addDay({ ...day('2026-11-21', kyoto, inn), stays: [inn] }, day('2026-11-22', inn, null))).wants, undefined)
})

test('宿の無い古い保存は、そのまま読める', () => {
  const d1 = day('2026-11-21', kyoto, null)
  const two = D.addDay(d1, day('2026-11-22', kyoto, null))
  assert.equal(two.stays, undefined)
  assert.equal('tripEnd' in two, false)
})

test('宿を入れた旅の題は、全部の日で 1日目の出発地の名前', () => {
  const d1 = { ...day('2026-11-21', kyoto, inn), planDays: 3, stays: [inn, inn2], tripEnd: null }
  assert.equal(D.stayTitle(d1), '京都駅')
  const two = D.addDay(d1, day('2026-11-22', inn, inn2))
  assert.equal(D.stayTitle(two), '京都駅')
  const three = D.addDay(two, day('2026-11-23', inn2, kyoto))
  assert.equal(D.stayTitle(three), '京都駅')
  assert.equal(D.stayTitle(D.switchDay(three, 1)), '京都駅')
  assert.equal(D.stayTitle({ ...d1, stays: [null, inn2] }), '京都駅')
})

test('宿の無い旅と例のプランは、題を変えない', () => {
  assert.equal(D.stayTitle({ ...day('2026-11-21', kyoto, arashi), planDays: 2 }), null)
  const demo = { ...day('2026-11-21', kyoto, null), stays: [inn] }
  demo.data.demo = true
  assert.equal(D.stayTitle(demo), null)
})

test.after(() => server.close())
