// 何日かある旅（宿泊）の日の入れ替え・追加・削除の試験。実行: node --test web/tests/multi-day.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const D = await server.ssrLoadModule('/src/lib/days.ts')

const spot = (id, name) => ({ id, name, lat: 35, lng: 135.7 })
const kyoto = { text: '京都駅', name: '京都駅', lat: 34.98, lng: 135.75 }
const inn = { text: '嵐山の宿', name: '嵐山の宿', lat: 35.01, lng: 135.67 }
// 1 日分の取っておく形（試験に要る所だけ）
const day = (date, ids, query = { area: '京都', wish: '庭', start: kyoto, end: null }) => ({
  data: { area: { name: '京都' }, start: kyoto, places: ids.map(([id, name]) => spot(id, name)), query },
  areaText: query.start.text,
  wish: query.wish,
  date,
  start: 600,
  end: 1080,
  shown: ids.map(([id]) => ({ id, slot: 'sight' })),
  base: null,
  since: 111,
})

test('1日だけの旅は、そのまま 1 日として読む', () => {
  const s = day('2026-11-21', [['a', '二条城']])
  assert.equal(D.allDays(s).length, 1)
  assert.equal(D.dayIndex(s), 0)
  assert.deepEqual(D.tripDates(s), ['2026-11-21'])
  assert.equal(D.otherStops(s), 0)
})

test('次の日を加えると、その日が開き、前の日は days に入る。since は同じ', () => {
  const d1 = day('2026-11-21', [['a', '二条城'], ['b', '鹿王院']])
  const d2 = { ...day('2026-11-22', [['c', '南禅寺']]), since: 999 }
  const s = D.addDay(d1, d2)
  assert.equal(s.day, 1)
  assert.equal(s.days.length, 2)
  assert.equal(s.days[1], null)
  assert.equal(s.days[0].date, '2026-11-21')
  assert.equal(s.days[0].days, undefined)
  assert.equal(s.date, '2026-11-22')
  assert.equal(s.since, 111)
  assert.equal(s.days[0].since, 111)
  assert.deepEqual(D.tripDates(s), ['2026-11-21', '2026-11-22'])
  assert.equal(D.otherStops(s), 2)
})

test('日を替えると、本体とその日が入れ替わり、全日の中身は変わらない', () => {
  const s = D.addDay(day('2026-11-21', [['a', '二条城']]), day('2026-11-22', [['c', '南禅寺']]))
  const back = D.switchDay(s, 0)
  assert.equal(back.date, '2026-11-21')
  assert.equal(back.day, 0)
  assert.equal(back.days[0], null)
  assert.equal(back.days[1].date, '2026-11-22')
  assert.deepEqual(D.allDays(back).map((d) => d.date), D.allDays(s).map((d) => d.date))
  const again = D.switchDay(back, 1)
  assert.deepEqual(again, s)
})

test('前の日までに入れた場所は、id と名前の両方で候補から除く', () => {
  const s = day('2026-11-21', [['a', '二条城'], ['b', '鹿王院']])
  const used = D.usedPlaces(s)
  const next = { area: { name: '京都' }, start: kyoto, places: [spot('a', '二条城'), spot('x', '鹿 王院'), spot('c', '南禅寺')] }
  assert.deepEqual(D.dropUsed(next, used).places.map((p) => p.id), ['c'])
})

test('まだ入れていない場所: 足すときは同じ場所を 1 つにし、どれかの日に入れたら除く', () => {
  const a = { id: 'a', name: '首里城公園', lat: 26.217, lng: 127.719 }
  const b = { id: 'b', name: '美ら海水族館', lat: 26.694, lng: 127.878 }
  let c = D.addCarry([], [a, b])
  c = D.addCarry(c, [{ ...a, id: 'a2', name: '首里城 公園' }, a])
  assert.deepEqual(c.map((p) => p.id), ['a', 'b'])
  const s = day('2026-11-25', [['x', '国際通り']])
  assert.equal(D.dropCarried(c, D.usedPlaces(s)), c)
  const used = D.usedWith(D.usedPlaces(s), [{ id: 'z', name: '首里城', lat: 26.2171, lng: 127.7191 }])
  assert.deepEqual(D.dropCarried(c, used).map((p) => p.id), ['b'])
})

test('usedPlaces の skip の日は数えない（開いている日は今のプランで数えるため）', () => {
  const s = D.addDay(day('2026-11-21', [['a', '二条城']]), day('2026-11-22', [['b', '南禅寺']]))
  assert.deepEqual([...D.usedPlaces(s).ids].sort(), ['a', 'b'])
  assert.deepEqual([...D.usedPlaces(s, 1).ids], ['a'])
})

test('次の日の候補に、まだ入れていない場所を足して選んでおく。同じ id・同じ名前の候補があれば足さずにそれを選ぶ', () => {
  const a = { id: 'a', name: '首里城公園', lat: 26.217, lng: 127.719 }
  const b = { id: 'b', name: '美ら海水族館', lat: 26.694, lng: 127.878 }
  const d = { area: { name: '那覇' }, start: kyoto, places: [{ id: 'q', name: '首里城 公園', lat: 26.217, lng: 127.719 }, { id: 'r', name: '国際通り', lat: 26.215, lng: 127.687 }] }
  const out = D.withCarry(d, [a, b])
  assert.deepEqual(out.ids, ['q', 'b'])
  assert.deepEqual(out.data.places.map((p) => p.id), ['q', 'r', 'b'])
  assert.equal(D.withCarry(d, []).data, d)
})

test('まだ入れていない場所と名前の揺れた同じ場所が候補にあれば、足さずにそれを選ぶ。食事の店とは取り違えない', () => {
  const carry = { id: 'c1', name: '那覇国際通り商店街', kind: 'street', lat: 26.2155, lng: 127.6853 }
  const d = {
    area: { name: '那覇' },
    start: kyoto,
    places: [{ id: 'f1', name: '国際通り屋台村', kind: 'food', lat: 26.2153, lng: 127.6857 }, { id: 'k1', name: '国際通リ', kind: 'street', lat: 26.2157, lng: 127.68642 }],
  }
  const out = D.withCarry(d, [carry])
  assert.deepEqual(out.ids, ['k1'])
  assert.equal(out.data, d)
  const food = { ...d, places: [d.places[0]] }
  assert.deepEqual(D.withCarry(food, [{ ...carry, name: '国際通り' }]).ids, ['c1'])
})

test('前の日までに満たした希望（名前を書いた場所の近く・同じ名物の店）から来た候補は、ふつうの候補にする', () => {
  const w = (id, name, kind, lat, lng, extra = {}) => ({ id, name, kind, role: 'famous', source: 'wish', tags: [], lat, lng, ...extra })
  const d1 = {
    ...day('2026-11-26', []),
    data: {
      area: { name: '那覇' },
      start: kyoto,
      places: [w('s1', '首里城公園', 'sight', 26.217, 127.7195, { named: true }), w('a1', 'A&W 牧港店', 'food', 26.262, 127.716, { named: true, tags: ['洋食'] }), w('k1', '国際通り', 'street', 26.2155, 127.6853, { source: 'famous' })],
      query: { area: '那覇', wish: '首里城と国際通り、A&W', start: kyoto, end: null },
    },
    shown: [{ id: 's1', slot: 'sight' }, { id: 'a1', slot: 'lunch' }, { id: 'k1', slot: 'sight' }],
  }
  const met = D.metWishes(d1)
  assert.deepEqual(met.map((p) => p.id), ['s1', 'a1'])
  const next = {
    area: { name: '那覇' },
    start: kyoto,
    conditions: [{ tag: '洋食', label: 'A&Wのハンバーガー' }],
    places: [
      w('s2', '首里金城町石畳道', 'street', 26.2155, 127.7158, { named: true }),
      w('a2', 'A&W 国際通り松尾店', 'food', 26.2148, 127.6866, { named: true, tags: ['洋食'] }),
      w('b2', 'ハンバーガー ステーション', 'food', 26.21, 127.68, { tags: ['洋食'] }),
      w('n2', '国際通り', 'street', 26.2155, 127.6853, { named: true }),
      w('c2', 'ブルーシール 牧志店', 'cafe', 26.2152, 127.686, { tags: ['甘味'] }),
    ],
  }
  const out = D.quietMet(next, met)
  const by = new Map(out.places.map((p) => [p.id, p]))
  assert.equal(by.get('s2').source, 'famous')
  assert.equal(by.get('s2').named, undefined)
  assert.equal(by.get('a2').source, 'food')
  assert.equal(by.get('b2').source, 'food')
  assert.equal(by.get('n2').source, 'wish')
  assert.equal(by.get('n2').named, true)
  assert.equal(by.get('c2').source, 'wish')
  assert.equal(D.quietMet(next, []), next)
})

test('開いている日を消すと前の日が開き、後ろの日は詰まる', () => {
  let s = D.addDay(day('2026-11-21', [['a', '1']]), day('2026-11-22', [['b', '2']]))
  s = D.addDay(s, day('2026-11-23', [['c', '3']]))
  s = D.switchDay(s, 1)
  const r = D.removeDay(s)
  assert.equal(r.day, 0)
  assert.equal(r.date, '2026-11-21')
  assert.deepEqual(D.tripDates(r), ['2026-11-21', '2026-11-23'])
  assert.equal(r.since, 111)
})

test('1日目を消すと次の日が 1日目になり、残りが 1 日なら 1 日の旅に戻る', () => {
  const s = D.switchDay(D.addDay(day('2026-11-21', [['a', '1']]), day('2026-11-22', [['b', '2']])), 0)
  const r = D.removeDay(s)
  assert.equal(r.date, '2026-11-22')
  assert.equal(r.days, undefined)
  assert.equal(r.day, undefined)
})

test('次の日は、片道の旅なら到着地から、戻る旅なら出発地から始める', () => {
  const round = day('2026-11-21', [])
  assert.deepEqual(D.nextDayAsk(round), { start: kyoto, end: null, area: '京都' })
  const oneWay = day('2026-11-21', [], { area: '', wish: '', start: kyoto, end: inn })
  assert.deepEqual(D.nextDayAsk(oneWay), { start: inn, end: null })
})

test('次の日の日付は、月と年をまたぐ', () => {
  assert.equal(D.nextDate('2026-11-30'), '2026-12-01')
  assert.equal(D.nextDate('2026-12-31'), '2027-01-01')
})

test('日数は 4 日まで、保存の大きさを超える日は加えない', () => {
  let s = day('2026-11-21', [['a', '1']])
  for (const d of ['2026-11-22', '2026-11-23', '2026-11-24']) s = D.addDay(s, day(d, [['b', '2']]))
  assert.equal(D.allDays(s).length, 4)
  assert.equal(D.canAddDay(s, 900_000), false)
  const one = day('2026-11-21', [['a', '1']])
  assert.equal(D.canAddDay(one, 900_000), true)
  assert.equal(D.canAddDay(one, JSON.stringify(one).length), false)
})

test('予定の日数は、作った日数より少なくも 4 日より多くもならず、作った日数と同じなら持たない', () => {
  const one = day('2026-11-21', [['a', '1']])
  assert.equal(D.plannedDays(one), 1)
  assert.equal(D.plannedDays({ ...one, planDays: 'x' }), 1)
  const three = D.setPlannedDays(one, 3)
  assert.equal(three.planDays, 3)
  assert.equal(D.plannedDays(three), 3)
  assert.equal(D.allDays(three).length, 1)
  assert.equal(D.setPlannedDays(one, 9).planDays, 4)
  assert.equal(D.setPlannedDays(three, 1).planDays, undefined)
  const two = D.addDay(one, day('2026-11-22', [['b', '2']]))
  assert.equal(D.setPlannedDays(two, 1).planDays, undefined)
  assert.equal(D.plannedDays(D.setPlannedDays(two, 1)), 2)
})

test('まだ作っていない日の日付は、作った最後の日から 1 日ずつ続く', () => {
  const s = D.setPlannedDays(day('2026-11-30', [['a', '1']]), 3)
  assert.deepEqual(D.plannedDates(s), ['2026-11-30', '2026-12-01', '2026-12-02'])
  assert.deepEqual(D.tripDates(s), ['2026-11-30'])
  assert.deepEqual(D.plannedDates(day('2026-11-21', [])), ['2026-11-21'])
})

test('予定の日数は、日を替えても加えても残り、予定より先まで加えると増える', () => {
  let s = D.setPlannedDays(day('2026-11-21', [['a', '1']]), 3)
  s = D.addDay(s, day('2026-11-22', [['b', '2']]))
  assert.equal(D.plannedDays(s), 3)
  assert.equal(s.days[0].planDays, undefined)
  s = D.switchDay(s, 0)
  assert.equal(D.plannedDays(s), 3)
  s = D.addDay(s, day('2026-11-23', [['c', '3']]))
  assert.equal(s.planDays, undefined)
  s = D.addDay(s, day('2026-11-24', [['d', '4']]))
  assert.equal(D.plannedDays(s), 4)
})

test('日を消すと、予定の日数も 1 日減る', () => {
  let s = D.setPlannedDays(day('2026-11-21', [['a', '1']]), 3)
  s = D.addDay(s, day('2026-11-22', [['b', '2']]))
  const r = D.removeDay(s)
  assert.equal(D.allDays(r).length, 1)
  assert.equal(D.plannedDays(r), 2)
  assert.deepEqual(D.plannedDates(r), ['2026-11-21', '2026-11-22'])
  const plain = D.removeDay(D.addDay(day('2026-11-21', [['a', '1']]), day('2026-11-22', [['b', '2']])))
  assert.equal(plain.planDays, undefined)
  assert.equal(D.plannedDays(plain), 1)
})

test('日の切り替えには、予定している日と加えている途中の日まで出し、例のプランは作った日だけ', () => {
  const one = day('2026-11-21', [['a', '1']])
  assert.equal(D.tabDates(one), null)
  assert.deepEqual(D.tabDates(one, 2), ['2026-11-21', '2026-11-22'])
  const planned = D.setPlannedDays(one, 3)
  assert.deepEqual(D.tabDates(planned), ['2026-11-21', '2026-11-22', '2026-11-23'])
  assert.deepEqual(D.tabDates(planned, 2), ['2026-11-21', '2026-11-22', '2026-11-23'])
  const demo = { ...planned, data: { ...planned.data, demo: true } }
  assert.equal(D.tabDates(demo), null)
  assert.equal(D.tabDates(demo, 2), null)
})

test.after(() => server.close())

test('次の日の候補から、名前の揺れた同じ場所と place_id の同じ場所も除く。名前が似ていても離れた場所は残す', () => {
  const near = (id, name, lat, lng, extra = {}) => ({ id, name, lat, lng, ...extra })
  const d1 = {
    ...day('2026-11-25', []),
    data: { area: { name: '那覇' }, start: kyoto, places: [near('s1', '首里城', 26.217, 127.719), near('a1', '美ら海水族館', 26.694, 127.878, { placeId: 'P1' })], query: { area: '那覇', wish: '', start: kyoto, end: null } },
    shown: [{ id: 's1', slot: 'sight' }, { id: 'a1', slot: 'sight' }],
  }
  const next = {
    area: { name: '那覇' },
    start: kyoto,
    places: [
      near('x1', '首里城公園', 26.2172, 127.7195),
      near('x2', '沖縄美ら海水族館', 26.6942, 127.8779, { placeId: 'P1' }),
      near('x3', '首里城公園', 35.0, 135.7),
      near('x4', '国際通り', 26.215, 127.687),
    ],
  }
  assert.deepEqual(D.dropUsed(next, D.usedPlaces(d1)).places.map((p) => p.id), ['x3', 'x4'])
})

test('次の日の候補から、片仮名と平仮名だけが違う同じ場所も除く。名前の続く別の場所は残す', () => {
  const near = (id, name, lat, lng) => ({ id, name, lat, lng })
  const d1 = {
    ...day('2026-11-25', []),
    data: { area: { name: '那覇' }, start: kyoto, places: [near('n1', '那覇国際通り商店街', 26.2155, 127.6853)], query: { area: '那覇', wish: '', start: kyoto, end: null } },
    shown: [{ id: 'n1', slot: 'sight' }],
  }
  const next = {
    area: { name: '那覇' },
    start: kyoto,
    places: [near('y1', '国際通リ', 26.2157, 127.68642), near('y2', '波の上うみそら公園', 26.2207, 127.6716), near('y3', '首里金城町石畳道', 26.2155, 127.7158)],
  }
  assert.deepEqual(D.dropUsed(next, D.usedPlaces(d1)).places.map((p) => p.id), ['y2', 'y3'])
  assert.equal(D.normName('ｺｸｻｲ通リ'), D.normName('こくさい通り'))
})
