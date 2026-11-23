// 場所の欄で、遅れて返った古い問い合わせの答えが欄に入らない試験。実行: node --test web/tests/place-field-race.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

// 問い合わせごとに、答えを返す時を試験の側で決める
const waiting = new Map()
globalThis.fetch = (url) => {
  const q = new URL(url, 'http://x').searchParams.get('q')
  return new Promise((ok) => waiting.set(q, (hit) => ok(hit ? new Response(JSON.stringify(hit), { status: 200 }) : new Response('{"error":"notfound"}', { status: 404 }))))
}
const answer = async (q, hit) => {
  for (let i = 0; i < 50 && !waiting.has(q); i++) await new Promise((r) => setTimeout(r, 5))
  const f = waiting.get(q)
  assert.ok(f, `問い合わせ ${q} が来ていない`)
  waiting.delete(q)
  f(hit)
  await new Promise((r) => setTimeout(r, 5))
}

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const P = await server.ssrLoadModule('/src/lib/placeField.ts')

const field = () => {
  const seen = { text: '', hit: null, state: 'idle' }
  const f = P.fieldLogic({ text: (v) => (seen.text = v), hit: (h) => (seen.hit = h), state: (s) => (seen.state = s) })
  return { f, seen }
}
const gion = { name: '祇園', pref: '京都府', city: '京都市', lat: 35.0047, lng: 135.7784 }
const fukuoka = { name: '祇園駅', pref: '福岡県', city: '福岡市', lat: 33.59, lng: 130.41 }

test('同じ文字で、エリアの名前の違う問い合わせが 2 つ飛んだら、後の答えだけを欄に入れる', async () => {
  const { f, seen } = field()
  f.setText('祇園')
  const a = f.lookup('福岡市')
  const b = f.lookup('京都市')
  await answer('京都市 祇園', gion)
  assert.deepEqual(await b, gion)
  assert.deepEqual(seen.hit, gion)
  await answer('福岡市 祇園', fukuoka)
  assert.deepEqual(await a, gion)
  assert.deepEqual(seen.hit, gion)
  assert.equal(seen.state, 'found')
})

test('外から場所を入れたあとに返った問い合わせは、欄に入れない', async () => {
  const { f, seen } = field()
  f.setText('嵐山')
  const a = f.lookup('京都市')
  const arashi = { name: '嵐山駅', pref: '京都府', city: '京都市', lat: 35.0142, lng: 135.6776 }
  f.set('嵐山', arashi)
  await answer('京都市 嵐山', null)
  await answer('嵐山', null)
  assert.deepEqual(await a, arashi)
  assert.deepEqual(seen.hit, arashi)
  assert.equal(seen.state, 'found')
})

test('文字を書き換えたあとに返った問い合わせは、欄に入れない', async () => {
  const { f, seen } = field()
  f.setText('岡崎')
  const a = f.lookup()
  f.setText('岡崎公園')
  await answer('岡崎', { name: '岡崎駅', pref: '愛知県', city: '岡崎市', lat: 34.9, lng: 137.1 })
  assert.equal(await a, null)
  assert.equal(seen.hit, null)
  assert.equal(seen.state, 'idle')
})

test.after(() => server.close())
