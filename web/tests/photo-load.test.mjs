// 画像が読み込めることの試験（#314）。ネットワークは使わない。実行: node --test web/tests/photo-load.test.mjs
// 1. 場所の写真の決め方（読み込めなかった写真は使わず、種類のアイコンに戻る）
// 2. 例のプラン（server/sample.json・sample.en.json）に入れてある写真が、一覧に出せる形か
// 3. index.html と site.webmanifest が指すアイコンと OGP の画像が、public にあって壊れていないか
// 外の写真が実際に届くかは photo-live.test.mjs で確かめる（ネットワークが要るので CI では動かさない）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { samplePhotos } from './photo-sample.mjs'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { spotPhoto, wikiPhoto, usesGooglePhoto, thumbUrl, thumbSrcSet, wikiHeroSet } = await server.ssrLoadModule('/src/lib/photo.ts')

const WIKI = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/A.jpg/500px-A.jpg'
const credited = { url: WIKI, title: 'A', page: 'https://ja.wikipedia.org/wiki/A', author: 'x', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', source: 'https://commons.wikimedia.org/wiki/File:A.jpg' }
const spot = (photo, kind = 'sight') => ({ id: 'p1', name: 'A', kind, photo })
const google = { hours: [], mapsUri: '', photos: [{ name: 'places/abcdefghij/photos/abcdefghij' }, { name: 'places/abcdefghij/photos/klmnopqrst' }] }

test('作者とライセンスが分かる記事の写真を、Google の写真より先に使う', () => {
  assert.deepEqual(spotPhoto(spot(credited), google), { from: 'wiki', photo: credited })
})

test('記事の写真が読み込めなかったら、写真なし（種類のアイコン）に戻る', () => {
  assert.equal(spotPhoto(spot(credited), null, WIKI), null)
  // 記事の写真がある場所では、読み込めなくても Google の写真に替えない（場所の画面と一覧で写真を変えない）
  assert.equal(spotPhoto(spot(credited), google, WIKI), null)
})

test('作者かライセンスが分からない写真は使わない', () => {
  assert.equal(wikiPhoto(spot({ ...credited, license: '' })), null)
  assert.equal(wikiPhoto(spot({ ...credited, source: '' })), null)
  assert.equal(spotPhoto(spot({ ...credited, license: '' }), null), null)
})

test('記事の写真が無い場所は Google の 1 枚目を使い、読み込めなければ写真なしに戻る', () => {
  assert.deepEqual(spotPhoto(spot(undefined), google), { from: 'google', photo: google.photos[0] })
  assert.equal(spotPhoto(spot(undefined), google, google.photos[0].name), null)
  assert.equal(spotPhoto(spot(undefined), null), null)
  assert.equal(spotPhoto(spot(undefined), { ...google, photos: [] }), null)
})

test('通り・商店街には Google の写真を使わない', () => {
  assert.equal(usesGooglePhoto(spot(undefined, 'street')), false)
  assert.equal(spotPhoto(spot(undefined, 'street'), google), null)
})

test('Wikipedia の写真は読む幅を変えられ、ほかの置き場の写真は URL をそのまま使う', () => {
  assert.equal(thumbUrl(WIKI, 120), WIKI.replace('500px-', '120px-'))
  assert.equal(thumbSrcSet(WIKI), `${thumbUrl(WIKI, 120)} 1x, ${thumbUrl(WIKI, 120)} 2x, ${thumbUrl(WIKI, 250)} 3x`)
  assert.equal(wikiHeroSet(WIKI).split(', ').length, 3)
  const flickr = 'https://live.staticflickr.com/65535/53946348734_381d34558e_z.jpg'
  assert.equal(thumbUrl(flickr, 120), flickr)
})

// 例のプランの写真を読んでよい置き場（Wikipedia・Wikimedia Commons・Flickr）
const HOSTS = ['upload.wikimedia.org', 'thumb.wikimedia.org', 'live.staticflickr.com']

for (const file of ['sample.json', 'sample.en.json']) {
  test(`例のプラン（${file}）の写真は、どれも一覧に出せる形になっている`, () => {
    const photos = samplePhotos(file)
    assert.ok(photos.length > 0, '写真が 1 枚も無い')
    for (const { name, photo } of photos) {
      const u = new URL(photo.url)
      assert.equal(u.protocol, 'https:', `${name}: https でない`)
      assert.ok(HOSTS.includes(u.hostname), `${name}: 知らない置き場 ${u.hostname}`)
      assert.ok(wikiPhoto({ photo }), `${name}: ライセンスか出典が無い（一覧では種類のアイコンになる）`)
      assert.ok(photo.author, `${name}: 作者が無い`)
      // Wikipedia の写真は、一覧が 120px・250px の幅で読む。URL に幅が入っていないと大きい写真をそのまま読んでしまう
      if (u.hostname.endsWith('wikimedia.org')) assert.notEqual(thumbUrl(photo.url, 120), thumbUrl(photo.url, 250), `${name}: URL に幅（NNNpx-）が無い`)
    }
  })
}

// PNG の頭の 8 バイトと、IHDR に書いてある幅と高さ
function pngSize(path) {
  const b = readFileSync(path)
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${path}: PNG でない`)
  assert.equal(b.subarray(12, 16).toString('latin1'), 'IHDR', `${path}: IHDR が無い`)
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`
}

test('site.webmanifest のアイコンは public にあり、書いてある大きさの PNG になっている', () => {
  const m = JSON.parse(readFileSync(`${root}public/site.webmanifest`, 'utf8'))
  assert.ok(m.icons.length > 0)
  for (const i of m.icons) assert.equal(pngSize(`${root}public${i.src}`), i.sizes, i.src)
})

test('index.html が指すアイコンと OGP の画像は public にあって壊れていない', () => {
  const html = readFileSync(`${root}index.html`, 'utf8')
  const icons = [...html.matchAll(/<link rel="(?:icon|alternate icon|apple-touch-icon)"[^>]*href="(\/[^"]+)"/g)].map((m) => m[1])
  assert.ok(icons.length >= 3, `アイコンの指定が見つからない: ${icons}`)
  for (const href of icons) {
    const path = `${root}public${href}`
    if (href.endsWith('.png')) pngSize(path)
    else if (href.endsWith('.svg')) assert.match(readFileSync(path, 'utf8'), /<svg[\s>]/, href)
    else assert.ok(readFileSync(path).length > 0, href)
  }
  const og = html.match(/property="og:image" content="https?:\/\/[^/"]+(\/[^"]+)"/)
  assert.ok(og, 'og:image が無い')
  const [w, h] = ['width', 'height'].map((k) => html.match(new RegExp(`og:image:${k}" content="(\\d+)"`))[1])
  assert.equal(pngSize(`${root}public${og[1]}`), `${w}x${h}`)
})

test.after(() => server.close())
