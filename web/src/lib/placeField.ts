// 出発地・到着地の欄。書いた文字を地図のデータで引くのは、欄を離れたときと作るときだけ（打つたびには引かない）。
// 文字を書き換えたら、前に引いた場所は使わない
import { useMemo, useRef, useState } from 'react'
import { findPlace, type GeoHit } from './api'
import { isEn } from './i18n'

export type FieldState = 'idle' | 'finding' | 'found' | 'miss' | 'error'
export type PlaceField = {
  text: string
  hit: GeoHit | null
  state: FieldState
  setText: (v: string) => void
  set: (text: string, hit: GeoHit | null) => void
  // near: 行き先のエリアの名前（宿と観光を終える場所は、まず「エリア 欄の文字」で引き、無ければ欄の文字だけで引く）
  lookup: (near?: string) => Promise<GeoHit | null>
}

// 宿と観光を終える場所を引くときに前に付ける、行き先のエリアの名前。引けた行き先の市（「京都市」「箱根」）、
// 無ければ行き先の欄の文字から末尾の「駅」を外した物（「京都駅 祇園」は見つからず、「京都市 祇園」は見つかる）
export function nearOf(hit: GeoHit | null | undefined, text: string): string {
  const city = hit?.city?.trim()
  if (city) return city
  return text.trim().replace(/\s*(駅|station)$/i, '').trim()
}

// 欄の文字を引く問い合わせの順（エリアの名前を前に付けた物 → 欄の文字だけ）。欄にエリアの名前が入っていれば欄の文字だけ
export function placeQueries(text: string, near = ''): string[] {
  const t = text.trim()
  const n = near.trim()
  if (!t) return []
  if (!n || t.includes(n) || n.includes(t)) return [t]
  return [`${n} ${t}`, t]
}

// 同じ問い合わせの答え（見つからなかった答えも）を、画面を開いている間は使い回す。届かなかったときは取っておかない
const asked = new Map<string, Promise<GeoHit | null>>()
function find(q: string): Promise<GeoHit | null> {
  const got = asked.get(q)
  if (got) return got
  const p = findPlace(q)
  asked.set(q, p)
  p.catch(() => asked.delete(q))
  return p
}

// 問い合わせを順に引き、最初に見つかった場所（どれも見つからなければ null。どれかが届かなければ例外）
export async function findFirst(queries: string[]): Promise<GeoHit | null> {
  for (const q of queries) {
    const h = await find(q)
    if (h) return h
  }
  return null
}

// 欄の文字・引いた場所・引く処理（画面の状態は put で知らせる）。引くのは問い合わせごとに番号を付け、最新の番号の答えだけを欄に入れる
export function fieldLogic(put: { text: (v: string) => void; hit: (h: GeoHit | null) => void; state: (s: FieldState) => void }): Pick<PlaceField, 'setText' | 'set' | 'lookup'> {
  // near: その場所を引いたときのエリアの名前（'' はエリアの名前を付けずに引いた場所、undefined は外から入れた場所）
  let cur: { text: string; hit: GeoHit | null; near?: string } = { text: '', hit: null }
  let asking: { key: string; p: Promise<GeoHit | null> } | null = null
  let seq = 0
  const setText = (v: string) => {
    const same = v.trim() === cur.text.trim()
    cur = { text: v, hit: same ? cur.hit : null, ...(same && { near: cur.near }) }
    put.text(v)
    if (!same) {
      seq++
      asking = null
      put.hit(null)
      put.state('idle')
    }
  }
  const set = (t: string, h: GeoHit | null) => {
    seq++
    asking = null
    cur = { text: t, hit: h }
    put.text(t)
    put.hit(h)
    put.state(h ? 'found' : 'idle')
  }
  const lookup = (near?: string): Promise<GeoHit | null> => {
    const t = cur.text.trim()
    if (!t) {
      put.state('idle')
      return Promise.resolve(null)
    }
    const n = near?.trim() ?? ''
    // 引いた場所は、外から入れた物か、同じエリアの名前で引いた物なら使う（行き先が変わったら引き直す）
    if (cur.hit && (cur.near === undefined || cur.near === n)) return Promise.resolve(cur.hit)
    const queries = placeQueries(t, n)
    const key = queries.join('\n')
    if (asking?.key === key) return asking.p
    put.state('finding')
    const my = ++seq
    // 後から別の問い合わせを始めたときは、その答え（無ければ欄の今の場所）を返す
    const later = (): Promise<GeoHit | null> | GeoHit | null => (asking && asking.p !== p ? asking.p : cur.text.trim() === t ? cur.hit : null)
    const p: Promise<GeoHit | null> = findFirst(queries)
      .then(
        (h) => {
          if (my !== seq) return later()
          cur = { text: cur.text, hit: h, near: n }
          put.hit(h)
          put.state(h ? 'found' : 'miss')
          return h
        },
        () => {
          if (my !== seq) return later()
          put.state('error')
          return null
        },
      )
      .finally(() => {
        if (asking?.p === p) asking = null
      })
    asking = { key, p }
    return p
  }
  return { setText, set, lookup }
}

export function usePlaceField(): PlaceField {
  const [text, setText] = useState('')
  const [hit, setHit] = useState<GeoHit | null>(null)
  const [state, setState] = useState<FieldState>('idle')
  const logic = useRef<ReturnType<typeof fieldLogic> | null>(null)
  logic.current ??= fieldLogic({ text: setText, hit: setHit, state: setState })
  const f = logic.current
  return useMemo(() => ({ text, hit, state, setText: f.setText, set: f.set, lookup: f.lookup }), [text, hit, state, f])
}

// 欄の下に出す、引けた場所（例「市ヶ谷駅（東京都新宿区）」）
export function placeLabel(h: GeoHit): string {
  if (isEn) {
    const at = [h.city, h.pref].filter(Boolean).join(', ')
    return at ? `${h.name} (${at})` : h.name
  }
  const at = `${h.pref ?? ''}${h.city && h.city !== h.pref ? h.city : ''}`
  return at ? `${h.name}（${at}）` : h.name
}
