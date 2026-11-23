// 例のプランの写真が、置き場（Wikipedia・Flickr）から実際に届くことの試験（#314）。
// ネットワークが要り、置き場の都合で落ちることがあるので、PHOTO_LIVE=1 を付けたときだけ動かす（CI では動かさない）。
// 実行: PHOTO_LIVE=1 node --test web/tests/photo-live.test.mjs （置き場に続けて頼みすぎないよう 1 枚ずつ 3 秒あける。約 2 分）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { samplePhotos } from './photo-sample.mjs'

const live = process.env.PHOTO_LIVE === '1'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// 一覧が読むのと同じ 250px の幅にする（web/src/lib/photo.ts の thumbUrl と同じ置き換え）
const listUrl = (url) => url.replace(/\/\d+px-/, '/250px-')
// 画像の頭のバイト（JPEG・PNG・WebP・GIF）
const isImage = (b) => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || b.subarray(0, 4).toString('latin1') === 'RIFF' || b.subarray(0, 3).toString('latin1') === 'GIF'

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'IntenTrip-photo-check/1.0 (node --test)' } })
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: Buffer.from(await res.arrayBuffer()) }
}

test('例のプランの写真が、どれも画像として届く', { skip: !live && 'PHOTO_LIVE=1 を付けたときだけ動かす', timeout: 600_000 }, async () => {
  const seen = new Map()
  for (const file of ['sample.json', 'sample.en.json']) for (const { name, photo } of samplePhotos(file)) seen.set(listUrl(photo.url), name)
  const bad = []
  for (const [url, name] of seen) {
    let r = await get(url)
    // 頼みすぎと言われたら、1 回だけ待ってやり直す
    if (r.status === 429) {
      await wait(30_000)
      r = await get(url)
    }
    if (r.status !== 200 || !r.type.startsWith('image/') || !isImage(r.body)) bad.push(`${name}: ${r.status} ${r.type} ${url}`)
    await wait(3000)
  }
  assert.deepEqual(bad, [], `届かない写真が ${bad.length} 枚`)
})
