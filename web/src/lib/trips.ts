// 旅のクラウド保存（Firestore の users/{uid}/trips/{tripId}）。ログインしているときだけ使い、
// していないときは今までどおり端末（localStorage）だけに取っておく。使い方は data/auth-and-trips.md。
//
// 旅に入れる物: 題名・エリア・日付・作った時刻・直した時刻・場所の数と、端末に取ってあるプラン（Saved）を丸ごと、
// その旅の選んだ理由とミッション（since より後の分）。入れない物: ミッションの写真（端末にだけ残す）、名前・メールアドレス、
// Google で照合した位置（照合の前の位置に戻し、place_id だけを残す。開いた端末で必要なら取り直す）。
import { useEffect, useState } from 'react'
import type { AreaData } from '../types'
import { authState, firebaseCore, onAuthChange } from './auth'
import type { Store } from './firestore'
import { byLang, lang, type Lang } from './i18n'
import { readTripOdai, writeTripOdai, ODAI_EVENT, type OdaiItem } from './odai'
import { expireGoogleLocations } from './place'
import { nameFound, stripFound } from './found'
import { isSaved, onReplaceSaved, readSaved, writeSaved, type Saved } from './saved'
import { notifyWhy, readTrip as readWhy, writeTrip as writeWhy, WHY_EVENT, type Why } from './why'

export type TripMeta = {
  id: string
  title: string
  area: string // エリアの名前（data.area.name。理由とミッションはこの名前で端末に取ってある）
  date: string // 旅の日（YYYY-MM-DD）
  createdAt: number // ミリ秒
  updatedAt: number
  stops: number // プランの場所の数
  lang: Lang // 作ったときの画面の言語
}
export type CloudOdai = Omit<OdaiItem, 'photo'>
export type Trip = TripMeta & {
  since: number // この旅を作り始めた時刻（理由とミッションは、これより後の分がこの旅の物）
  saved: Saved
  why: Why[]
  odai: CloudOdai[]
}

// Firestore に入れる形。中身の大きい物は JSON の文字列にする（ルールで大きさを確かめやすく、索引も作らせない）
type TripDoc = Omit<TripMeta, 'id'> & { v: 1; since: number; state: string; why: string; odai: string }
export const LIMITS = { title: 120, area: 120, state: 900_000, why: 60_000, odai: 60_000 } as const

// 旅の題名。出発地に戻らない旅は「出発地 → 到着地」（欄に書いた文字で）、戻る旅は出発地かエリアの名前。
// 作った旅の頼み（query）を先に見る（入力の欄はあとで書き換えていることがあるため）
export function tripTitle(data: AreaData, startText: string): string {
  const q = data.query
  const from = q?.area || startText.trim() || (data.end ? data.start.name : data.area.name)
  return data.end ? `${from} → ${q?.end?.text || data.end.name}` : from
}

// ---- 端末の今の旅 ----

// 端末の今のプランが、どの旅か（since で結び付ける。since が変わったら新しい旅）
type Binding = { id: string; since: number; createdAt: number; title?: string; uid?: string; sig?: string; off?: boolean }
const BIND = byLang('intentrip:trip:v1')
const OPEN_EVENT = 'intentrip:trip-open'
const NEW_EVENT = 'intentrip:trip-new'

function readBinding(): Binding | null {
  try {
    const b = JSON.parse(window.localStorage.getItem(BIND) || 'null') as Binding | null
    return b && typeof b.id === 'string' && typeof b.since === 'number' ? b : null
  } catch {
    return null
  }
}
function writeBinding(b: Binding) {
  try {
    window.localStorage.setItem(BIND, JSON.stringify(b))
  } catch {
    /* 取っておけないときは、そのまま */
  }
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export function newTripId(): string {
  const r = new Uint8Array(20)
  crypto.getRandomValues(r)
  return Array.from(r, (n) => ID_CHARS[n % ID_CHARS.length]).join('')
}

// 例のプランの旅の id（言語ごとに 1 つ。開き直しても同じ旅として上書きする）
const DEMO_ID = `example-${lang}`

function bindingFor(since: number, demo: boolean): Binding {
  const b = readBinding()
  if (b && b.since === since) return b
  const next: Binding = { id: demo ? DEMO_ID : newTripId(), since, createdAt: Date.now() }
  writeBinding(next)
  return next
}

// 端末の今のプランの旅の id（プランが無いときは null）
export function currentTripId(): string | null {
  const s = readSaved()
  if (!s || s.example) return null
  const b = readBinding()
  return b && b.since === (s.since ?? 0) ? b.id : null
}

// プランの場所の数（App がプランを組むたびに知らせる）
let stops = 0
export function noteStops(n: number) {
  if (n === stops) return
  stops = n
  queueCloudSave()
}

// Google で照合した位置を、照合の前の位置に戻す（place_id は残す）。検索で入れた場所の名前と営業時間を外す
function forCloud(s: Saved): Saved {
  const c = JSON.parse(JSON.stringify(s)) as Saved
  delete c.example
  expireGoogleLocations(c.data.places, Number.POSITIVE_INFINITY)
  c.data.places = stripFound(c.data.places)
  return c
}

// 端末の今の状態を、旅の形にする（プランが無いときは null）
export function tripFromDevice(): Trip | null {
  const saved = readSaved()
  if (!saved || saved.example) return null
  const since = saved.since ?? 0
  const b = bindingFor(since, !!saved.data.demo)
  const area = saved.data.area.name
  return {
    id: b.id,
    title: (b.title ?? tripTitle(saved.data, saved.areaText)).slice(0, LIMITS.title),
    area: area.slice(0, LIMITS.area),
    date: saved.date,
    createdAt: b.createdAt,
    updatedAt: Date.now(),
    stops,
    lang,
    since,
    saved: forCloud(saved),
    why: readWhy(area).items.filter((w) => w.at >= since),
    odai: readTripOdai(area)
      .items.filter((x) => x.at >= since)
      .map(({ photo: _photo, ...x }) => x),
  }
}

const odaiKey = (x: { spotId: string; at: number }) => `${x.spotId}:${x.at}`

// 旅を端末の今の状態にする（開いている画面は変えない。画面ごと開き直すなら openTrip）。書き込めたら true
// 理由とミッションは、この旅より前の分（at < since）を残し、この旅の分を入れ替える。端末にだけある写真は付け直し、
// この旅に無い、写真を撮ったミッションも消さずに残す
export function tripToDevice(t: Trip): boolean {
  const saved: Saved = { ...t.saved, since: t.since }
  if (!writeSaved(saved)) return false
  const area = saved.data.area.name
  writeWhy(area, { items: [...readWhy(area).items.filter((w) => w.at < t.since), ...t.why] })
  notifyWhy()
  const local = readTripOdai(area).items
  const photos = new Map(local.filter((x) => x.photo).map((x) => [odaiKey(x), x.photo as string]))
  const keys = new Set(t.odai.map(odaiKey))
  const kept = local.filter((x) => x.at < t.since || (!!x.photo && !keys.has(odaiKey(x))))
  const mine = t.odai.map((x): OdaiItem => {
    const photo = photos.get(odaiKey(x))
    return photo ? { ...x, photo } : { ...x }
  })
  writeTripOdai(area, { items: [...kept, ...mine].sort((a, b) => a.at - b.at) })
  stops = t.stops
  const b: Binding = { id: t.id, since: t.since, createdAt: t.createdAt, title: t.title, uid: authState().user?.uid }
  writeBinding(b)
  const now = tripFromDevice()
  if (now) writeBinding({ ...b, sig: sigOf(toDoc(now)) })
  return true
}

// ---- 端末の棚（今開いていない旅。ログインしていなくても、端末に SHELF_MAX 件まで残す） ----

// 今の旅も入れて、端末に残す旅の数
export const DEVICE_MAX = 10
const SHELF_MAX = DEVICE_MAX - 1
const SHELF = byLang('intentrip:shelf:v1')
const SHELF_EVENT = 'intentrip:shelf'

function isTrip(v: unknown): v is Trip {
  const t = v as Trip | null
  return !!t && typeof t.id === 'string' && isSaved(t.saved) && Array.isArray(t.why) && Array.isArray(t.odai)
}

// 棚の旅（直した時刻の新しい順）
export function readShelf(): Trip[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(SHELF) || '[]') as unknown
    return Array.isArray(list) ? list.filter(isTrip) : []
  } catch {
    return []
  }
}

// 棚に書く。端末の空きが足りないときは、古い旅から外して入る分だけ残す
function writeShelf(list: Trip[]) {
  let keep = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SHELF_MAX)
  for (;;) {
    try {
      if (keep.length) window.localStorage.setItem(SHELF, JSON.stringify(keep))
      else window.localStorage.removeItem(SHELF)
      break
    } catch {
      if (!keep.length) break
      keep = keep.slice(0, -1)
    }
  }
  window.dispatchEvent(new Event(SHELF_EVENT))
}

// 端末の今の旅を棚へ移す（別の旅に置き換わる前に、saved.ts から呼ばれる）。
// 次も例のプランなら、今の例のプランと棚の例のプランは移さずに外す（例のプランは 1 件だけ）
function shelveCurrent(next: Saved) {
  const t = tripFromDevice()
  const demo = !!next.data.demo
  const rest = readShelf().filter((x) => x.id !== t?.id && !(demo && x.id === DEMO_ID))
  if (t && !(demo && t.id === DEMO_ID)) writeShelf([t, ...rest])
  else if (rest.length !== readShelf().length) writeShelf(rest)
}
onReplaceSaved(shelveCurrent)

export function removeFromShelf(id: string) {
  const list = readShelf()
  if (list.some((t) => t.id === id)) writeShelf(list.filter((t) => t.id !== id))
}

// React の画面用。棚の旅の一覧（中身は含めない）
export function useShelf(): TripMeta[] {
  const metas = () => readShelf().map(({ id, title, area, date, createdAt, updatedAt, stops, lang: l }) => ({ id, title, area, date, createdAt, updatedAt, stops, lang: l }))
  const [list, setList] = useState(metas)
  useEffect(() => {
    const f = () => setList(metas())
    window.addEventListener(SHELF_EVENT, f)
    return () => window.removeEventListener(SHELF_EVENT, f)
  }, [])
  return list
}

export function shelfTrip(id: string): Trip | null {
  return readShelf().find((t) => t.id === id) ?? null
}

// 旅を開く（端末に入れて、画面を開き直す）。書き込めたら true
export function openTrip(t: Trip): boolean {
  if (!tripToDevice(t)) return false
  removeFromShelf(t.id)
  const url = new URL(window.location.href)
  if (url.searchParams.has('start')) {
    url.searchParams.delete('start')
    window.history.replaceState(window.history.state, '', url.toString())
  }
  window.dispatchEvent(new Event(OPEN_EVENT))
  return true
}

// 新しい旅を作り始める（入力の画面を開く。プランを作ると、新しい旅として保存する）
export function newTrip() {
  window.dispatchEvent(new Event(NEW_EVENT))
}

export function onTripOpen(f: () => void): () => void {
  window.addEventListener(OPEN_EVENT, f)
  return () => window.removeEventListener(OPEN_EVENT, f)
}
export function onTripNew(f: () => void): () => void {
  window.addEventListener(NEW_EVENT, f)
  return () => window.removeEventListener(NEW_EVENT, f)
}

// ---- Firestore との行き来 ----

function toDoc(t: Trip): TripDoc {
  return {
    v: 1,
    title: t.title.slice(0, LIMITS.title),
    area: t.area.slice(0, LIMITS.area),
    date: t.date,
    createdAt: Math.round(t.createdAt),
    updatedAt: Math.round(t.updatedAt),
    stops: Math.max(0, Math.min(100, Math.round(t.stops))),
    lang: t.lang,
    since: Math.round(t.since),
    state: JSON.stringify(t.saved),
    why: JSON.stringify(t.why),
    odai: JSON.stringify(t.odai),
  }
}
const fits = (d: TripDoc) => d.state.length <= LIMITS.state && d.why.length <= LIMITS.why && d.odai.length <= LIMITS.odai

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
function metaOf(id: string, d: Record<string, unknown>): TripMeta {
  return {
    id,
    title: String(d.title ?? ''),
    area: String(d.area ?? ''),
    date: String(d.date ?? ''),
    createdAt: num(d.createdAt),
    updatedAt: num(d.updatedAt),
    stops: num(d.stops),
    lang: d.lang === 'en' ? 'en' : 'ja',
  }
}
function tripOf(id: string, d: Record<string, unknown>): Trip | null {
  try {
    const saved = JSON.parse(String(d.state)) as unknown
    const why = JSON.parse(String(d.why ?? '[]')) as unknown
    const odai = JSON.parse(String(d.odai ?? '[]')) as unknown
    if (!isSaved(saved) || !Array.isArray(why) || !Array.isArray(odai)) return null
    expireGoogleLocations(saved.data.places)
    nameFound(saved.data.places)
    return { ...metaOf(id, d), since: num(d.since), saved, why: why as Why[], odai: odai as CloudOdai[] }
  } catch {
    return null
  }
}

// 中身の印（直した時刻は除く）。同じ中身なら書かない
function sigOf(d: TripDoc): string {
  const s = JSON.stringify({ ...d, updatedAt: 0 })
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return `${s.length}:${(h >>> 0).toString(36)}`
}

let storeP: Promise<Store | null> | null = null
function store(): Promise<Store | null> {
  storeP ??= firebaseCore().then(async (c) => (c ? (await import('./firestore')).init(c) : null)).catch(() => null)
  return storeP
}
const uidNow = () => authState().user?.uid ?? null

// 自分の旅の一覧（直した時刻の新しい順・50 件まで）。ログインしていないときは空
export async function listTrips(): Promise<TripMeta[]> {
  const uid = uidNow()
  const s = uid ? await store() : null
  if (!uid || !s) return []
  try {
    return (await s.list(uid)).map((r) => metaOf(r.id, r.data))
  } catch {
    return []
  }
}

// 自分の旅の一覧を見張る（変わるたびに f を呼ぶ。ログインしていないときは空の一覧）。止める関数を返す
export function watchTrips(f: (trips: TripMeta[]) => void): () => void {
  let stop: (() => void) | null = null
  let uid: string | null | undefined
  let alive = true
  const follow = () => {
    if (!authState().ready) return
    const next = uidNow()
    if (next === uid) return
    stop?.()
    stop = null
    uid = next
    if (!next) return f([])
    void store().then((s) => {
      if (!alive || uid !== next || !s) return
      stop = s.watch(next, (rows) => f(rows.map((r) => metaOf(r.id, r.data))), () => f([]))
    })
  }
  const off = onAuthChange(follow)
  void firebaseCore().then(follow)
  return () => {
    alive = false
    off()
    stop?.()
  }
}

// React の画面用。trips は届くまで null
export function useTrips(): TripMeta[] | null {
  const [trips, setTrips] = useState<TripMeta[] | null>(null)
  useEffect(() => watchTrips(setTrips), [])
  return trips
}

// 旅を 1 つ読む（無い・読めないときは null）
export async function loadTrip(id: string): Promise<Trip | null> {
  const uid = uidNow()
  const s = uid ? await store() : null
  if (!uid || !s) return null
  try {
    const d = await s.get(uid, id)
    return d ? tripOf(id, d) : null
  } catch {
    return null
  }
}

// 旅を書く（題名を変えたときなど）。書けたら true
export async function saveTrip(t: Trip): Promise<boolean> {
  const uid = uidNow()
  const d = toDoc({ ...t, updatedAt: Date.now() })
  const s = uid && fits(d) ? await store() : null
  if (!uid || !s) return false
  try {
    await s.set(uid, t.id, d)
    const b = readBinding()
    if (b && b.id === t.id) writeBinding({ ...b, title: t.title })
    return true
  } catch {
    return false
  }
}

// 旅を消す。端末の今の旅なら、プランは端末に残し、クラウドへの自動の保存だけを止める（新しい旅を作ると、また保存する）
export async function deleteTrip(id: string): Promise<boolean> {
  const uid = uidNow()
  const s = uid ? await store() : null
  if (!uid || !s) return false
  try {
    await s.remove(uid, id)
    removeFromShelf(id)
    const b = readBinding()
    if (b && b.id === id) writeBinding({ ...b, off: true })
    return true
  } catch {
    return false
  }
}

// ---- 自動の保存 ----
// 手を入れるたびに書くと回数が増えるので、手が止まって SAVE_WAIT たったら（続けて直していても SAVE_MAX ごとに）、
// まとめて 1 回書く。中身が前に書いたときと同じなら書かない。ページを閉じる・隠すときは、待たずに書く
const SAVE_WAIT = 4000
const SAVE_MAX = 30000
let timer = 0
let firstAt = 0
let writing = false
let again = false

export function queueCloudSave() {
  if (!uidNow()) return
  const now = Date.now()
  if (!firstAt) firstAt = now
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void flushCloudSave(), now - firstAt >= SAVE_MAX ? 0 : SAVE_WAIT)
}

export async function flushCloudSave(): Promise<boolean> {
  window.clearTimeout(timer)
  timer = 0
  firstAt = 0
  if (writing) {
    again = true
    return false
  }
  const uid = uidNow()
  const t = uid ? tripFromDevice() : null
  const b = readBinding()
  if (!uid || !t || !b || b.id !== t.id || b.off) return false
  const d = toDoc(t)
  const sig = sigOf(d)
  if (b.uid === uid && b.sig === sig) return true
  if (!fits(d)) return false
  writing = true
  try {
    const s = await store()
    if (!s || uidNow() !== uid) return false
    await s.set(uid, t.id, d)
    const now = readBinding()
    if (now && now.id === t.id) writeBinding({ ...now, uid, sig })
    return true
  } catch {
    return false
  } finally {
    writing = false
    if (again) {
      again = false
      queueCloudSave()
    }
  }
}

// App が開いたときに 1 回呼ぶ。設定があれば Firebase を読み込み、ログインしたら端末の今のプランを旅として足す
let started = false
export function startCloudSync() {
  if (started) return
  started = true
  let uid: string | null = null
  onAuthChange(() => {
    const next = uidNow()
    if (next && next !== uid) void flushCloudSave()
    uid = next
  })
  const warm = () => void firebaseCore()
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(warm, { timeout: 2000 })
  else setTimeout(warm, 1000)
  window.addEventListener(WHY_EVENT, queueCloudSave)
  window.addEventListener(ODAI_EVENT, queueCloudSave)
  const now = () => {
    if (timer) void flushCloudSave()
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && now())
  window.addEventListener('pagehide', now)
}
