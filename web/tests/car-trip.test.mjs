// 希望の文と 1 行の文から、車で回るかを読み取る試験。実行: node --test web/tests/car-trip.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const { mentionsCar } = await server.ssrLoadModule('/src/lib/carTrip.ts')

test('車で回ると書いてあれば true', () => {
  for (const t of ['沖縄に2泊3日、レンタカーで回る', '車で美ら海水族館に行きたい', 'ドライブしながら海を見たい', '車を借りて回りたい', '車移動', 'マイカーで行く', 'by car', 'Okinawa for 2 nights with a rental car', 'We will drive around the island', 'Road trip in Hokkaido'])
    assert.equal(mentionsCar(t), true, t)
})

test('電車・自転車・人力車などの「車」は数えない', () => {
  for (const t of ['電車で回りたい', '自転車で回る', '人力車に乗りたい', '観覧車に乗る', '駐車場が無い所', '静かな場所', '新幹線で来る', '', 'Quiet temples by train'])
    assert.equal(mentionsCar(t), null, t)
})

test('車を使わないと書いてあれば false', () => {
  for (const t of ['車は使わない', 'レンタカーは借りない', '運転しないので電車で', '免許がない', 'no car', "I don't drive", 'without a car'])
    assert.equal(mentionsCar(t), false, t)
})

test.after(() => server.close())
