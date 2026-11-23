// 候補を探している間の待ち画面に出す人気スポットの扱いの試験。実行: node --test web/tests/wait-spots.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { keepPreview, previewSpot, previewTopics, stepLine } = await server.ssrLoadModule('/src/lib/waitSpots.ts')

const spot = (name, group = 'famous') => ({ id: name, name, kind: group === 'food' || group === 'cafe' ? group : 'sight', tags: [], why: `${name}の特徴`, lat: 35, lng: 135.7, group })
const kyoto = { area: '京都', places: [spot('清水寺')] }
const kamakura = { area: '鎌倉', places: [spot('長谷寺')] }

test('進み具合の丸は、済んだ段を済んだ順に左から並べる', () => {
  const st = (famous, food, hidden, cafe) => [
    { key: 'famous', state: famous },
    { key: 'food', state: food },
    { key: 'hidden', state: hidden },
    { key: 'cafe', state: cafe },
  ]
  const seen = []
  const line = (x) => stepLine(x, seen).map((s) => `${s.key}:${s.state}`).join(' ')
  assert.equal(line(st('run', 'run', 'run', 'run')), 'famous:run food:run hidden:run cafe:run')
  assert.equal(line(st('run', 'run', 'run', 'done')), 'cafe:done famous:run food:run hidden:run')
  assert.equal(line(st('done', 'run', 'run', 'done')), 'cafe:done famous:done food:run hidden:run')
  assert.equal(line(st('done', 'run', 'done', 'done')), 'cafe:done famous:done hidden:done food:run')
  assert.equal(line(st('done', 'done', 'done', 'done')), 'cafe:done famous:done hidden:done food:done')
})

test('届くまでは出さない', () => {
  assert.equal(keepPreview(null, undefined), null)
  assert.equal(keepPreview(null, { area: '京都', places: [] }), null)
  assert.equal(keepPreview(null, { area: '', places: [spot('a')] }), null)
})

test('届いたら出し、出した種類は探し終わるまで入れ替えない', () => {
  const first = keepPreview(null, kyoto)
  assert.equal(first, kyoto)
  assert.equal(keepPreview(first, kamakura), kyoto)
  assert.equal(keepPreview(first, undefined), kyoto)
})

test('まだ無い種類だけを後ろに足す（前の行は動かさない）', () => {
  const first = keepPreview(null, { area: '京都', places: [spot('いづう', 'food')] })
  const next = keepPreview(first, { area: '京都', places: [spot('別の店', 'food'), spot('清水寺'), spot('喫茶', 'cafe')] })
  assert.deepEqual(next.places.map((p) => p.name), ['いづう', '清水寺', '喫茶'])
  assert.equal(keepPreview(next, { area: '京都', places: [spot('清水寺'), spot('金閣寺')] }), next)
})

test('見どころとお店に分ける（最初に出た順）', () => {
  const t = previewTopics([spot('清水寺'), spot('いづう', 'food'), spot('隠れた所', 'hidden'), spot('喫茶', 'cafe')])
  assert.deepEqual(t.map((x) => [x.topic, x.places.map((p) => p.name)]), [['sights', ['清水寺', '隠れた所']], ['food', ['いづう', '喫茶']]])
  assert.deepEqual(previewTopics([spot('喫茶', 'cafe'), spot('清水寺')]).map((x) => x.topic), ['food', 'sights'])
})

test('一覧の小さな写真に渡せる形にする', () => {
  const s = previewSpot({ ...spot('清水寺'), tags: undefined })
  assert.deepEqual(s.tags, [])
  assert.equal(s.name, '清水寺')
  assert.equal(s.why, '清水寺の特徴')
  assert.equal(s.kind, 'sight')
  assert.equal(s.group, undefined)
  assert.equal(previewSpot(spot('いづう', 'food')).kind, 'food')
  assert.equal(previewSpot(spot('隠れた所', 'hidden')).source, 'hidden')
})

test.after(() => server.close())
