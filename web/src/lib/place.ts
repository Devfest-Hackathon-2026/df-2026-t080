// Google の Places の内容（写真・評価・営業時間）。規約で Google 以外の地図とは一緒に使えないので、
// 地図が Google マップのときだけ取る。サーバーは取っておかずに返すだけで、画面もページを開いている間だけ
// （長くても KEEP_MS まで）持つ。取るのは場所の画面と候補の画面を開いたときだけで、一覧の小さな写真は、
// 開いた画面で取った内容を使い回す（自分では取らない）
import { useEffect, useState } from 'react'
import { hasServer } from './api'
import { loggedFetch } from './apiLog'
import { googleMapsShown, onMapsShown, onMapsUnavailable } from './gmaps'
import { lang } from './i18n'
import type { AreaData, Spot } from '../types'

export type PlacePhoto = { name: string; width?: number; height?: number; authors: { name: string; uri: string }[] }
export type PlaceInfo = {
  rating?: number | null
  count?: number | null
  hours: { day: string; text: string }[] // 月曜から 7 日
  mapsUri: string
  photos: PlacePhoto[]
  // 検索で入れた場所を開き直したときに戻す、名前・位置・曜日ごとの営業時間
  name?: string
  lat?: number
  lng?: number
  periods?: [number, number, number | null, number | null][] | null
}

// Google マップの地図が出ていると分かったときだけ true。分かるまでと、キーが無い・キーが通らなかった・
// 読み込めなかったとき（MapLibre の地図）は false なので、その間は Places に問い合わせない
export function useGoogleMapShown(): boolean {
  const [shown, setShown] = useState(googleMapsShown)
  useEffect(() => {
    const offShown = onMapsShown(() => setShown(googleMapsShown()))
    const offGone = onMapsUnavailable(() => setShown(false))
    return () => {
      offShown()
      offGone()
    }
  }, [])
  return shown
}

// Places の内容が届くまで待つ長さ。これを過ぎたら、写真を待つ枠を外す
const WAIT_MS = 4000

export type PlaceState = { info: PlaceInfo | null; waiting: boolean }

// 取った内容を持っておく長さ。写真の名前は時間が経つと使えなくなるので、長くは持たない
const KEEP_MS = 15 * 60 * 1000
const memo = new Map<string, { at: number; info: Promise<PlaceInfo | null> }>()
const loaded = new Map<string, { at: number; info: PlaceInfo }>()
const listeners = new Set<() => void>()

// サーバーの Places の枠が尽きた（503・429）ときは、しばらくどの場所も聞かない
const PAUSE_MS = 2 * 60 * 1000
let pausedUntil = 0

// その場所の Places の内容。同じ場所を続けて聞かない（届かなかったとき・枠が尽きていたとき・サーバーが失敗したときは、次にまた聞く）
function loadPlace(placeId: string): Promise<PlaceInfo | null> {
  const now = Date.now()
  const had = memo.get(placeId)
  if (had && now - had.at < KEEP_MS) return had.info
  if (now < pausedUntil) return Promise.resolve(null)
  const info = loggedFetch(`/api/place/${encodeURIComponent(placeId)}?lang=${lang}`)
    .then((r) => {
      if (r.status === 503 || r.status === 429) {
        pausedUntil = Date.now() + PAUSE_MS
        memo.delete(placeId)
        return null
      }
      if (r.status >= 500) {
        memo.delete(placeId)
        return null
      }
      return r.ok ? (r.json() as Promise<PlaceInfo>) : null
    })
    .then((x) => {
      if (!x || !Array.isArray(x.photos) || !Array.isArray(x.hours)) return null
      loaded.set(placeId, { at: Date.now(), info: x })
      listeners.forEach((f) => f())
      return x
    })
    .catch(() => {
      memo.delete(placeId)
      return null
    })
  memo.set(placeId, { at: now, info })
  return info
}

// 検索で入れた場所を開き直したときに、名前・位置・営業時間を聞き直す（Google の地図を出しているときだけ。出していなければ null）
export const placeDetails = (placeId: string): Promise<PlaceInfo | null> => (googleMapsShown() && hasServer ? loadPlace(placeId) : Promise.resolve(null))

// まだ照合していない候補（place_id が無く、見つからなかった印も無い）は、画面を開いたときにサーバーが 1 か所だけ照合する。
// 候補の id ごとに、その答えを持っておく
const found = new Map<string, Promise<string | null>>()
const foundIds = new Map<string, string>()

function placeIdOf(spot: Spot, area: AreaData['area']): Promise<string | null> {
  if (spot.placeId) return Promise.resolve(spot.placeId)
  if (spot.placeMiss) return Promise.resolve(null)
  const had = found.get(spot.id)
  if (had) return had
  if (Date.now() < pausedUntil) return Promise.resolve(null)
  const pick = <T extends { name: string; ja?: string; lat: number; lng: number }>(p: T) => ({ name: p.name, ja: p.ja, lat: p.lat, lng: p.lng })
  const id = loggedFetch('/api/place-find', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ place: pick(spot), area: { ...pick(area), radius: area.radius } }),
  })
    .then((r) => {
      if (r.status === 503 || r.status === 429) {
        pausedUntil = Date.now() + PAUSE_MS
        found.delete(spot.id)
        return null
      }
      return r.ok ? (r.json() as Promise<{ placeId?: string | null }>) : null
    })
    .then((x) => {
      const pid = typeof x?.placeId === 'string' ? x.placeId : null
      if (pid) foundIds.set(spot.id, pid)
      return pid
    })
    .catch(() => {
      found.delete(spot.id)
      return null
    })
  found.set(spot.id, id)
  return id
}

// 場所の画面や候補の画面が出ている間だけ、その場所の Places の内容を取る。
// info は取れないとき・読み込み中は null。waiting は、Places の内容を待っている間（届いた・失敗・時間切れで false）
export function usePlaceInfo(spot: Spot | undefined, area: AreaData['area']): PlaceState {
  const shown = useGoogleMapShown()
  const [got, setGot] = useState<{ id: string; info: PlaceInfo } | null>(null)
  const [settled, setSettled] = useState('')
  const key = spot?.id ?? ''
  const asks = !!spot && (!!spot.placeId || !spot.placeMiss)
  useEffect(() => {
    const s = spot
    if (!s || !asks || !shown || !hasServer) return
    let alive = true
    const settle = () => {
      if (alive) setSettled(s.id)
    }
    const timer = setTimeout(settle, WAIT_MS)
    placeIdOf(s, area)
      .then((pid) => (pid ? loadPlace(pid) : null))
      .then((info) => {
        if (info && alive) setGot({ id: s.id, info })
      })
      .finally(settle)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [key, spot?.placeId, asks, shown])
  const info = shown && got && got.id === key ? got.info : null
  return { info, waiting: asks && shown && hasServer && settled !== key }
}

// 候補ではない場所（この付近で検索の結果など）の Places の内容。place_id で直に聞く
export function usePlaceById(placeId: string | null): PlaceState {
  const shown = useGoogleMapShown()
  const [got, setGot] = useState<{ id: string; info: PlaceInfo | null } | null>(null)
  useEffect(() => {
    if (!placeId || !shown || !hasServer) return
    let alive = true
    loadPlace(placeId).then((info) => {
      if (alive) setGot({ id: placeId, info })
    })
    return () => {
      alive = false
    }
  }, [placeId, shown])
  const done = !!got && got.id === placeId
  return { info: shown && done ? got.info : null, waiting: !!placeId && shown && hasServer && !done }
}

// 一覧の行の小さな写真用。場所の画面か候補の画面で、もう取ってある内容だけを返す（自分では取らないので、waiting はいつも false）
export function useLoadedPlaceInfo(spot: Spot): PlaceState {
  const shown = useGoogleMapShown()
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    listeners.add(f)
    return () => {
      listeners.delete(f)
    }
  }, [])
  const placeId = spot.placeId ?? foundIds.get(spot.id)
  const hit = placeId && shown && hasServer ? loaded.get(placeId) : undefined
  return { info: hit && Date.now() - hit.at < KEEP_MS ? hit.info : null, waiting: false }
}

// Google の写真は、場所の画面の大きな写真も一覧の小さな写真も同じ幅で頼む（同じ URL なので、ブラウザが 1 回の読み込みを使い回す）
export const GOOGLE_PHOTO_W = 960
export const placePhotoUrl = (name: string, w: number = GOOGLE_PHOTO_W) => `/api/place-photo?name=${encodeURIComponent(name)}&w=${w}`

// その日（YYYY-MM-DD）が月曜から何日目か（0〜6）
export const weekIndex = (iso: string) => (new Date(`${iso}T00:00:00`).getDay() + 6) % 7

// Places から取った位置は 30 日までしか持てない。ブラウザに取っておいたプランを読むときに、
// 30 日を過ぎた候補を照合の前の位置に戻す（place_id は残す）。戻した数を返す
const KEEP_DAYS = 30
export function expireGoogleLocations(spots: Spot[], now = Date.now()): number {
  let n = 0
  for (const s of spots) {
    if (typeof s.locatedAt !== 'number' || now / 1000 - s.locatedAt <= KEEP_DAYS * 86400) continue
    if (Array.isArray(s.guess) && s.guess.length === 2) [s.lat, s.lng] = s.guess
    delete s.locatedAt
    delete s.verified
    n++
  }
  return n
}
