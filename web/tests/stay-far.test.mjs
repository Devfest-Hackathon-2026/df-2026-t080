// 宿の欄の離れすぎの一言と、欄に出す泊の試験。実行: node --test web/tests/stay-far.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window ??= { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {}, location: { search: '' }, navigator: { languages: ['ja'], language: 'ja' } }
globalThis.localStorage ??= window.localStorage

const server = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const F = await server.ssrLoadModule('/src/lib/stayFar.ts')

const kyoto = { name: '京都駅', lat: 34.9858, lng: 135.7588 }
const shijo = { name: '四条の宿', lat: 35.0037, lng: 135.7597 }
const osaka = { name: '大阪の宿', lat: 34.7025, lng: 135.4959 }
const kobe = { name: '神戸の宿', lat: 34.6913, lng: 135.1830 }
const umeda = { name: '大阪駅', lat: 34.7055, lng: 135.4983 }

test('毎晩同じ宿と、泊が 1 つのときは最初の泊の欄だけ', () => {
  assert.deepEqual(F.shownNights([1, 2, 3], true), [1])
  assert.deepEqual(F.shownNights([1, 2, 3], false), [1, 2, 3])
  assert.deepEqual(F.shownNights([2], false), [2])
  assert.deepEqual(F.shownNights([], false), [])
})

test('近い宿だけなら、どの欄にも出さない', () => {
  assert.deepEqual(F.stayFarTexts(kyoto, [shijo, null], kyoto, false), [null, null])
})

test('出発地から遠い 1泊目の宿は、その欄に出す', () => {
  const out = F.stayFarTexts(kyoto, [kobe], kyoto, false)
  assert.match(out[0], /^最初の場所から\d+ km あります/)
})

test('前の泊の宿から遠い宿は、その泊の欄に出す（空の欄は前の泊と同じとして飛ばす）', () => {
  const out = F.stayFarTexts(umeda, [osaka, null, kobe], kobe, false)
  assert.equal(out[0], null)
  assert.equal(out[1], null)
  assert.equal(out[2], null)
  const far = F.stayFarTexts(kyoto, [shijo, kobe], kyoto, false)
  assert.equal(far[0], null)
  assert.match(far[1], /^前の宿から\d+ km あります/)
})

test('最後の宿から観光を終える場所が遠いときは、最後の宿の欄に出す', () => {
  assert.deepEqual(F.stayFarTexts(umeda, [osaka], kobe, false), [null])
  const far = F.stayFarTexts(umeda, [osaka], kyoto, false)
  assert.match(far[0], /^観光を終える場所から\d+ km あります/)
  const stay = F.stayFarTexts(kobe, [shijo], kyoto, true)
  assert.match(stay[0], /^前の宿から\d+ km あります/)
})

test.after(() => server.close())
