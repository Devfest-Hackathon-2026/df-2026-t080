// 取っておいた旅を読むときに、旅の全日の分で形の壊れた物を無い物として扱う試験。実行: node --test web/tests/saved-shape.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const store = new Map()
globalThis.window ??= { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const V = await server.ssrLoadModule('/src/lib/saved.ts')
const D = await server.ssrLoadModule('/src/lib/days.ts')
const S = await server.ssrLoadModule('/src/lib/stayTalk.ts')

const kyoto = { text: '京都駅', name: '京都駅', lat: 34.9858, lng: 135.7588 }
const inn = { text: '四条', name: '四条', lat: 35.0037, lng: 135.7681 }
const day = (date) => ({
  data: { area: { name: '京都' }, start: kyoto, places: [{ id: date, name: date, lat: 35, lng: 135.7 }], query: { area: '京都駅', wish: '', start: kyoto, end: inn } },
  areaText: '京都駅',
  wish: '',
  date,
  start: 600,
  end: 1080,
  shown: [{ id: date, slot: 'sight' }],
  base: null,
  since: 1,
})

test('形の正しい旅の全日の分は、そのまま残す', () => {
  const s = { ...day('2026-11-21'), planDays: 3, stays: [inn, null], tripEnd: null, wants: { wish: '寺', days: [{ start: 540 }, { wish: '嵐山', end: 1020 }] } }
  const copy = structuredClone(s)
  assert.equal(V.isSaved(s), true)
  assert.deepEqual(s, copy)
})

test('壊れた stays・tripEnd・wants・planDays は外して、読める形にする', () => {
  const bad = [
    { stays: 'four' },
    { stays: [inn, { name: 1 }] },
    { tripEnd: 'kyoto' },
    { tripEnd: { text: 'a', name: 'a', lat: 'x', lng: 0 } },
    { wants: [] },
    { wants: { wish: '寺', days: 'x' } },
    { wants: { wish: '寺', days: [null] } },
    { wants: { wish: '寺', days: [{ start: '9時' }] } },
    { planDays: '3' },
    { planDays: null },
  ]
  for (const extra of bad) {
    const s = { ...day('2026-11-21'), ...extra }
    const key = Object.keys(extra)[0]
    assert.equal(V.isSaved(s), true)
    assert.equal(key in s, false, JSON.stringify(extra))
    assert.doesNotThrow(() => {
      D.plannedDays(s)
      D.addDayAsk(s)
      D.tripGoal(s)
      D.stayTitle(s)
      S.dayWants(s, 2)
    })
  }
})

test('壊れた days は日の切り替えごと外し、1 日の旅として読む', () => {
  for (const days of ['x', [null, 3], [null, { data: null }]]) {
    const s = { ...day('2026-11-21'), days, day: 0 }
    assert.equal(V.isSaved(s), true)
    assert.equal('days' in s, false)
    assert.equal('day' in s, false)
    assert.equal(D.allDays(s).length, 1)
  }
})

test('端末から読むときも、壊れた分を外す', () => {
  window.localStorage.setItem(V.STORE, JSON.stringify({ ...day('2026-11-21'), stays: { 0: inn }, wants: { wish: 3 } }))
  const s = V.readSaved()
  assert.ok(s)
  assert.equal(s.stays, undefined)
  assert.equal(s.wants, undefined)
  assert.equal(V.isSaved({ data: { places: 'x' } }), false)
  assert.equal(V.isSaved(null), false)
})

const shuri = { id: 's1', name: '首里城公園', kind: 'sight', role: 'famous', lat: 26.217, lng: 127.719, stay: 90, open: 510, close: 1080, tags: [], crowd: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], weekdayDrop: 0, why: '', downside: '', basis: '' }

test('まだ入れていない場所（carry）は、形が正しければ残し、壊れていれば外す', () => {
  const ok = { ...day('2026-11-21'), planDays: 3, carry: [shuri] }
  assert.equal(V.isSaved(ok), true)
  assert.deepEqual(ok.carry, [shuri])
  for (const carry of ['x', [null], [{ id: 1 }], [{ ...shuri, lat: 'a' }]]) {
    const s = { ...day('2026-11-21'), carry }
    assert.equal(V.isSaved(s), true)
    assert.equal('carry' in s, false, JSON.stringify(carry))
  }
})

test('carry は日を替えても加えても旅に 1 つのまま残り、日の中には入らない', () => {
  const s = { ...day('2026-11-21'), planDays: 3, carry: [shuri] }
  const two = D.addDay(s, day('2026-11-22'))
  assert.deepEqual(two.carry, [shuri])
  assert.equal(two.days[0].carry, undefined)
  const back = D.switchDay(two, 0)
  assert.deepEqual(back.carry, [shuri])
  assert.equal(back.days[1].carry, undefined)
  assert.equal(D.bare(back).carry, undefined)
})

test('carry の検索で入れた場所は、取っておくときに名前を外す', () => {
  const found = { ...shuri, id: 'g_P', name: '見つけた店', source: 'search', placeId: 'P' }
  const out = V.stripSaved({ ...day('2026-11-21'), carry: [shuri, found] })
  assert.equal(out.carry[0].name, '首里城公園')
  assert.equal(out.carry[1].name, '')
})

test('車で回る旅は、日を替えても加えても消しても旅に 1 つのまま残り、日の中には入らない', () => {
  const s = { ...day('2026-11-21'), planDays: 3, car: true }
  const two = D.addDay(s, { ...day('2026-11-22'), car: true })
  assert.equal(two.car, true)
  assert.equal(two.days[0].car, undefined)
  const back = D.switchDay(two, 0)
  assert.equal(back.car, true)
  assert.equal(back.days[1].car, undefined)
  assert.equal(D.bare(back).car, undefined)
  assert.equal(D.removeDay(back).car, true)
  assert.equal(D.setPlannedDays(back, 4).car, true)
})

test('車で回らない旅は car を持たず、壊れた car は外す', () => {
  const s = D.addDay(day('2026-11-21'), day('2026-11-22'))
  assert.equal('car' in s, false)
  const bad = { ...day('2026-11-21'), car: 'yes' }
  assert.equal(V.isSaved(bad), true)
  assert.equal('car' in bad, false)
})

test.after(() => server.close())
