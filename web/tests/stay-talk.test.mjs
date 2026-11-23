// 泊まりの旅を 1 行の文から作るときのまとめ・聞く順・日ごとの希望と時刻の試験。実行: node --test web/tests/stay-talk.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const S = await server.ssrLoadModule('/src/lib/stayTalk.ts')
const D = await server.ssrLoadModule('/src/lib/days.ts')

test('差分は、書いてある項目だけを上書きする', () => {
  let t = S.mergeTalk({}, { from: '京都', nights: 2, stays: ['四条', '嵐山'], wish: '静かな寺を回りたい' })
  assert.deepEqual(t, { from: '京都', nights: 2, over: false, stays: ['四条', '嵐山'], wish: '静かな寺を回りたい' })
  t = S.mergeTalk(t, { stays: ['四条', '岡崎'] })
  assert.deepEqual(t.stays, ['四条', '岡崎'])
  assert.equal(t.from, '京都')
  t = S.mergeTalk(t, { days: [{ start: 600 }, {}, { end: 1020 }] })
  t = S.mergeTalk(t, { days: [{}, { wish: '嵐山を歩きたい' }] })
  assert.deepEqual(t.days, [{ start: 600 }, { wish: '嵐山を歩きたい' }, { end: 1020 }])
  t = S.mergeTalk(t, { end: null })
  assert.equal(t.end, null)
  t = S.mergeTalk(t, { end: '嵐山駅' })
  assert.equal(t.end, '嵐山駅')
})

test('範囲外の泊数と時刻は入れず、4泊以上は印だけ', () => {
  let t = S.mergeTalk({ from: '京都' }, { over: true })
  assert.equal(t.over, true)
  assert.equal(t.nights, undefined)
  t = S.mergeTalk(t, { nights: 5, days: [{ start: 100, end: 2000 }] })
  assert.equal(t.nights, undefined)
  assert.deepEqual(t.days, [{}])
  t = S.mergeTalk(t, { nights: 3 })
  assert.equal(t.nights, 3)
  assert.equal(t.over, false)
})

test('聞くのは足りない物を 1 つだけ、決まった順に', () => {
  assert.equal(S.nextQuestion({}, [], false), 'start')
  assert.equal(S.nextQuestion({}, [], true), 'where')
  assert.equal(S.nextQuestion({ from: '金沢' }, [], true), 'nights')
  assert.equal(S.nextQuestion({ from: '金沢', nights: 4 }, [], true), 'date')
  const t = { from: '京都', nights: 2, stays: ['四条'], wish: '寺' }
  assert.equal(S.nextQuestion(t, [], true), 'date')
  assert.equal(S.nextQuestion(t, ['date'], true), 'time')
  assert.equal(S.nextQuestion({ ...t, days: [{ start: 600 }] }, ['date'], true), 'done')
  assert.equal(S.nextQuestion({ ...t, days: [{}, {}, { end: 1020 }] }, ['date'], true), 'done')
  assert.equal(S.nextQuestion({ from: '京都', nights: 2 }, ['date', 'stay', 'wish', 'time'], true), 'done')
  assert.equal(S.nextQuestion({ nights: 2 }, ['where', 'date'], true), 'where')
})

test('行き先と泊数がそろえば候補を検索できる', () => {
  assert.equal(S.talkReady({ from: '京都' }), false)
  assert.equal(S.talkReady({ nights: 2 }), false)
  assert.equal(S.talkReady({ from: '京都', nights: 1 }), true)
})

test('宿は同じ宿が続く泊をまとめる', () => {
  assert.deepEqual(S.stayRuns(['四条'], 2), [{ from: 1, to: 2, name: '四条' }])
  assert.deepEqual(S.stayRuns(['四条', null, '嵐山'], 3), [{ from: 1, to: 2, name: '四条' }, { from: 3, to: 3, name: '嵐山' }])
  assert.deepEqual(S.stayRuns([null, '嵐山'], 2), [{ from: 2, to: 2, name: '嵐山' }])
  assert.deepEqual(S.stayRuns(undefined, 2), [])
})

test('宿の欄に入れる形', () => {
  assert.deepEqual(S.stayFieldsOf(['四条']), { same: true, texts: ['四条'] })
  assert.deepEqual(S.stayFieldsOf(['四条', null, '四条']), { same: true, texts: ['四条'] })
  assert.deepEqual(S.stayFieldsOf(['四条', '嵐山']), { same: false, texts: ['四条', '嵐山'] })
  assert.deepEqual(S.stayFieldsOf([null, '嵐山']), { same: false, texts: ['', '嵐山'] })
})

test('その日の希望は、旅全体の希望のあとにつなぐ', () => {
  assert.equal(S.joinWish('静かな寺を回りたい', '嵐山を歩きたい'), '静かな寺を回りたい。嵐山を歩きたい')
  assert.equal(S.joinWish('静かな寺を回りたい。', '嵐山を歩きたい'), '静かな寺を回りたい。嵐山を歩きたい')
  assert.equal(S.joinWish('Quiet temples', 'Bamboo grove'), 'Quiet temples. Bamboo grove')
  assert.equal(S.joinWish('', '嵐山'), '嵐山')
  assert.equal(S.joinWish(' 寺 ', undefined), '寺')
})

test('n 日目の希望と時刻（まとめに無い時刻は省く）', () => {
  const wants = S.wantsOf('静かな寺を回りたい', [{ start: 600 }, { wish: '嵐山を歩きたい', end: 1080 }, { end: 1020 }])
  assert.deepEqual(wants, { wish: '静かな寺を回りたい', days: [{ start: 600 }, { wish: '嵐山を歩きたい', end: 1080 }, { end: 1020 }] })
  assert.deepEqual(S.dayWants({ wants }, 1), { wish: '静かな寺を回りたい', start: 600 })
  assert.deepEqual(S.dayWants({ wants }, 2), { wish: '静かな寺を回りたい。嵐山を歩きたい', end: 1080 })
  assert.deepEqual(S.dayWants({ wants }, 3), { wish: '静かな寺を回りたい', end: 1020 })
  assert.deepEqual(S.dayWants({ wants }, 4), { wish: '静かな寺を回りたい' })
  assert.equal(S.dayWants({}, 2), null)
  assert.equal(S.wantsOf('寺', [{}, {}]), undefined)
  assert.equal(S.wantsOf('寺', undefined), undefined)
})

test('観光を終える時刻は出発から 1 時間あける', () => {
  assert.equal(S.fitEnd(600, 1080), 1080)
  assert.equal(S.fitEnd(1140, 1080), 1200)
  assert.equal(S.fitEnd(1380, 600), 1435)
})

const kyoto = { text: '京都駅', name: '京都駅', lat: 34.9858, lng: 135.7588 }
const inn = { text: '四条の宿', name: '四条の宿', lat: 35.0037, lng: 135.7681 }
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

test('日ごとの希望は旅の全日で 1 つ持ち、日を加えても切り替えても残る', () => {
  const wants = { wish: '寺', days: [{}, { wish: '嵐山' }] }
  const first = { ...day('2026-11-21'), planDays: 3, stays: [inn], wants }
  const two = D.addDay(first, day('2026-11-22'))
  assert.deepEqual(two.wants, wants)
  assert.equal(two.days.filter(Boolean).some((d) => 'wants' in d), false)
  assert.deepEqual(D.switchDay(two, 0).wants, wants)
  assert.deepEqual(S.dayWants(two, 2), { wish: '寺。嵐山' })
  assert.equal('wants' in D.bare(two), false)
})

test('泊数を変えたら、最終日の帰る時刻を新しい最終日へ移し、範囲外の日は捨てる', () => {
  let t = S.mergeTalk({}, { from: '京都', nights: 3, days: [{ start: 540 }, { wish: '嵐山' }, { end: 1080 }, { end: 1020 }] })
  t = S.mergeTalk(t, { nights: 2 })
  assert.deepEqual(t.days, [{ start: 540 }, { wish: '嵐山' }, { end: 1020 }])
  let u = S.mergeTalk({}, { from: '京都', nights: 1, days: [{ start: 600 }, { end: 1020 }] })
  u = S.mergeTalk(u, { nights: 3 })
  assert.deepEqual(u.days, [{ start: 600 }, {}, {}, { end: 1020 }])
  assert.equal(S.dayWants({ wants: S.wantsOf('', u.days) }, 2).end, undefined)
  const v = S.mergeTalk(S.mergeTalk({}, { nights: 2 }), { nights: 3, days: [{}, {}, {}, { end: 960 }] })
  assert.deepEqual(v.days, [{}, {}, {}, { end: 960 }])
  assert.deepEqual(S.mergeTalk({ nights: 1 }, { days: [{}, {}, { end: 1000 }] }).days, [{}, {}])
})

test('保存に持つ日ごとの希望は、旅の日数より後の日を捨てる', () => {
  const days = [{ start: 540 }, {}, { end: 1020 }, { end: 1000 }]
  assert.deepEqual(S.wantsOf('寺', days, 3), { wish: '寺', days: [{ start: 540 }, {}, { end: 1020 }] })
  assert.deepEqual(S.wantsOf('', S.fitDays(days, 3, 1), 2), { wish: '', days: [{ start: 540 }, { end: 1000 }] })
  assert.equal(S.wantsOf('', [{}, { end: 1000 }], 1), undefined)
})

test('返ってきた宿の空の泊は、今のまとめのその泊の宿で埋める（1 つだけなら毎晩同じ宿）', () => {
  const t = { from: '京都', nights: 2, stays: ['四条', '嵐山'] }
  assert.deepEqual(S.mergeTalk(t, { stays: [null, '岡崎'] }).stays, ['四条', '岡崎'])
  assert.deepEqual(S.mergeTalk(t, { stays: ['祇園', null] }).stays, ['祇園', '嵐山'])
  assert.deepEqual(S.mergeTalk(t, { stays: ['祇園'] }).stays, ['祇園'])
  assert.deepEqual(S.mergeTalk({ from: '京都', nights: 2, stays: ['四条'] }, { stays: [null, '嵐山'] }).stays, ['四条', '嵐山'])
  assert.deepEqual(S.mergeTalk({ from: '京都', nights: 3 }, { stays: ['四条', null, '岡崎'] }).stays, ['四条', null, '岡崎'])
})

test('4泊以上の印は、次の差分で消える', () => {
  let t = S.mergeTalk({ from: '京都', nights: 2 }, { over: true })
  assert.equal(t.over, true)
  assert.equal(t.nights, 2)
  t = S.mergeTalk(t, { wish: '寺' })
  assert.equal(t.over, false)
})

test.after(() => server.close())
