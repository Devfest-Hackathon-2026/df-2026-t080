// 旅の振り返りの画像に載せる中身（lib/recap.ts の recapInput・crowdLine）の試験。実行: node --test web/tests/recap-card.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { recapInput, crowdLine, isFeatured } = await server.ssrLoadModule('/src/lib/recap.ts')
const { FOUND_NAME } = await server.ssrLoadModule('/src/lib/found.ts')

const photo = { url: 'https://upload.wikimedia.org/x/500px-a.jpg', page: 'A', title: 'A', author: 'Someone', license: 'CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:a.jpg' }
const spot = (id, name, extra = {}) => ({ id, name, kind: 'sight', downside: `${name}は坂が多い`, tags: [], crowd: [], weekdayDrop: 0, lat: 35, lng: 135, ...extra })
const leg = (mode, minutes) => ({ mode, minutes, label: '', from: { lat: 0, lng: 0 }, to: { lat: 0, lng: 0 } })
const stop = (s, arrive, l, extra = {}) => ({ spot: s, slot: 'sight', leg: l, arrive, depart: arrive + 60, stay: 60, wait: 0, ease: 0, level: 1, estimated: true, closeOver: false, timeNote: null, role: '人気スポット', reason: '', fits: [], finale: false, ...extra })
const plan = (stops) => ({ stops, back: leg('walk', 12), backTimeNote: null, leave: 9 * 60, finish: 17 * 60, crowded: 0, moving: 60, ease: 0, backEase: 0, score: 0, dropped: [], added: [] })
const base = { area: '京都', date: '11月14日（土）', title: ['清水寺の眺め'], start: '京都駅', goal: '京都駅', usual: null }

test('理由が 1 か所でも、その日の場所を全部、順に載せる', () => {
  const p = plan([stop(spot('a', '清水寺'), 9 * 60 + 30, leg('transit', 30)), stop(spot('b', '白川一本橋'), 11 * 60, leg('walk', 7)), stop(spot('c', '法住寺'), 13 * 60, leg('transit', 22))])
  const r = recapInput({ ...base, plan: p, buses: [], whys: [{ spotId: 'c', spotName: '法住寺', chips: ['人が少なそう'], text: '', downsideSeen: '', at: 1 }], odai: [] })
  assert.deepEqual(r.stops.map((s) => [s.no, s.name, s.arrive]), [[1, '清水寺', 570], [2, '白川一本橋', 660], [3, '法住寺', 780]])
  assert.deepEqual(r.stops.map(isFeatured), [false, false, true])
  assert.equal(r.stops[2].reason, '人が少なそう')
  assert.equal(r.stops[2].downside, '法住寺は坂が多い')
  assert.equal(r.stops[0].downside, '')
})

test('区間の乗り物は、見つけた便があればその手段にする（無ければ「電車・バス」）', () => {
  const p = plan([stop(spot('a', 'A'), 600, leg('transit', 31)), stop(spot('b', 'B'), 700, leg('walk', 7)), stop(spot('c', 'C'), 800, leg('transit', 20))])
  const r = recapInput({ ...base, plan: p, buses: [{ mode: 'bus' }, undefined, undefined, undefined], whys: [], odai: [] })
  assert.deepEqual(r.stops.map((s) => [s.move.icon, s.move.word, s.move.min]), [['bus', 'バス', 31], ['walk', '徒歩', 7], ['train', '電車・バス', 20]])
  assert.deepEqual([r.back.icon, r.back.min], ['walk', 12])
})

test('ミッションの写真を撮った場所は、理由が無くても大きく出す', () => {
  const p = plan([stop(spot('a', 'A'), 600, leg('walk', 5))])
  const r = recapInput({ ...base, plan: p, buses: [], whys: [], odai: [{ spotId: 'a', spotName: 'A', kind: 'temple', text: '古い物を撮る', level: 'easy', rerolls: 0, photo: 'data:image/jpeg;base64,AAAA', at: 1 }] })
  assert.equal(isFeatured(r.stops[0]), true)
  assert.equal(r.stops[0].odai, '古い物を撮る')
})

test('作者とライセンスの分かる Wikimedia の写真だけを使い、出典の文を作る', () => {
  const p = plan([stop(spot('a', 'A', { photo }), 600, leg('walk', 5)), stop(spot('b', 'B', { photo: { ...photo, license: undefined } }), 700, leg('walk', 5))])
  const r = recapInput({ ...base, plan: p, buses: [], whys: [], odai: [] })
  assert.equal(r.stops[0].wiki?.credit, 'Someone・CC BY-SA 4.0')
  assert.equal(r.stops[1].wiki, undefined)
})

test('検索で入れた場所は、Google の名前を出さず、写真も使わない', () => {
  const p = plan([stop(spot('g_x', 'Google の名前', { source: 'search', photo }), 600, leg('walk', 5))])
  const r = recapInput({ ...base, plan: p, buses: [], whys: [], odai: [] })
  assert.equal(r.stops[0].name, FOUND_NAME)
  assert.equal(r.stops[0].wiki, undefined)
})

test('混雑の 1 行は、Compare と同じく 10 分以上短いときだけ出す', () => {
  const p = (crowded) => ({ ...plan([]), crowded })
  const u = (crowded) => ({ crowded, finish: 0, moving: 0, stops: [] })
  assert.equal(crowdLine(p(0), null), null)
  assert.equal(crowdLine(p(0), u(0)), 'never')
  assert.deepEqual(crowdLine(p(1), u(100)), { usual: 100, plan: 1 })
  assert.equal(crowdLine(p(95), u(100)), null)
  assert.equal(crowdLine(p(120), u(100)), null)
})

test.after(() => server.close())
