// 宿と観光を終える場所を、行き先のエリアの名前を前に付けて引く試験。実行: node --test web/tests/place-near.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const asked = []
const KNOWN = { '京都市 祇園': { name: '祇園', pref: '京都府', city: '京都市', lat: 35.0047, lng: 135.7784 }, 祇園: { name: '祇園駅', pref: '福岡県', city: '福岡市', lat: 33.59, lng: 130.41 }, 強羅: { name: '強羅駅', pref: '神奈川県', city: '箱根', lat: 35.25, lng: 139.05 } }
globalThis.fetch = async (url) => {
  const q = new URL(url, 'http://x').searchParams.get('q')
  asked.push(q)
  if (q === '落ちる') return new Response('{}', { status: 503 })
  return KNOWN[q] ? new Response(JSON.stringify(KNOWN[q]), { status: 200 }) : new Response('{"error":"notfound"}', { status: 404 })
}

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const P = await server.ssrLoadModule('/src/lib/placeField.ts')

test('前に付けるのは、引けた行き先の市か、行き先の文字から「駅」を外した物', () => {
  assert.equal(P.nearOf({ name: '京都駅', city: '京都市', pref: '京都府', lat: 0, lng: 0 }, '京都駅'), '京都市')
  assert.equal(P.nearOf(null, '京都駅'), '京都')
  assert.equal(P.nearOf(null, ' 金沢 '), '金沢')
  assert.equal(P.nearOf(null, 'Kyoto Station'), 'Kyoto')
  assert.equal(P.nearOf(undefined, ''), '')
})

test('問い合わせは「エリア 欄の文字」から、無ければ欄の文字だけ', () => {
  assert.deepEqual(P.placeQueries('祇園', '京都市'), ['京都市 祇園', '祇園'])
  assert.deepEqual(P.placeQueries('祇園', ''), ['祇園'])
  assert.deepEqual(P.placeQueries('京都市 祇園', '京都市'), ['京都市 祇園'])
  assert.deepEqual(P.placeQueries('京都', '京都市'), ['京都'])
  assert.deepEqual(P.placeQueries('  ', '京都市'), [])
})

test('エリアの名前つきで見つかれば 1 回、見つからなければ欄の文字だけでもう 1 回。同じ問い合わせは使い回す', async () => {
  asked.length = 0
  assert.equal((await P.findFirst(P.placeQueries('祇園', '京都市'))).pref, '京都府')
  assert.deepEqual(asked, ['京都市 祇園'])
  asked.length = 0
  assert.equal((await P.findFirst(P.placeQueries('強羅', '箱根'))).name, '強羅駅')
  assert.deepEqual(asked, ['箱根 強羅', '強羅'])
  asked.length = 0
  await P.findFirst(P.placeQueries('祇園', '京都市'))
  await P.findFirst(P.placeQueries('強羅', '箱根'))
  assert.deepEqual(asked, [])
  assert.equal(await P.findFirst(P.placeQueries('無い宿', '京都市')), null)
})

test('届かなかった問い合わせは取っておかず、次にまた聞く', async () => {
  asked.length = 0
  await assert.rejects(P.findFirst(['落ちる']))
  await assert.rejects(P.findFirst(['落ちる']))
  assert.deepEqual(asked, ['落ちる', '落ちる'])
})

test.after(() => server.close())
