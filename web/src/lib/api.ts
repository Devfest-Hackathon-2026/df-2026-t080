import type { AreaData, GeoHit, TripPoint } from '../types'
import { loggedFetch } from './apiLog'
import { isEn, lang } from './i18n'

export type StepKey = 'famous' | 'hidden' | 'food' | 'cafe' | 'wish' | 'verify'
export type JobState = {
  id: string
  state: 'running' | 'ready' | 'done' | 'error'
  version?: number
  steps?: { key: StepKey; state: 'wait' | 'run' | 'done' | 'error' }[]
  done?: number
  total?: number
  result?: AreaData
  error?: string
  // 今の様子の印。次に聞くときに渡すと、サーバーは様子が変わるまで返事を待つ
  tag?: string
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await loggedFetch(url, init)
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

// VITE_STATIC=true のビルド（GitHub Pages）では、サーバーが無いので同梱の sample.json だけで動かす
const STATIC = import.meta.env.VITE_STATIC === 'true'

// サーバーには画面の言語を渡す（英語のときは、候補・説明・頼みの返事を英語で作り、作り置きも英語の分を使う）
export const loadSample = () =>
  getJson<AreaData>(STATIC ? `${import.meta.env.BASE_URL}${isEn ? 'sample.en.json' : 'sample.json'}` : `/api/sample?lang=${lang}`).catch(() => null)
export type { GeoHit }
// 候補を取ってあるエリアの出発地（エリアの名前 → 出発地）。行き先の例を押したとき、取ってあればその出発地で頼む
export const loadAreaStarts = (): Promise<Record<string, GeoHit>> =>
  STATIC
    ? Promise.resolve({})
    : getJson<{ starts?: Record<string, GeoHit> }>(`/api/areas?lang=${lang}`)
        .then((d) => d.starts ?? {})
        .catch(() => ({}))
// 出発地・到着地に書いた文字を地図のデータで引く（見つからなければ null。サーバーに届かないときは例外）
export async function findPlace(q: string): Promise<GeoHit | null> {
  if (STATIC) throw new Error('static')
  const r = await loggedFetch(`/api/geocode?q=${encodeURIComponent(q)}&lang=${lang}`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}
// 頼む旅。start と end（無ければ出発地に戻る）で頼む。area は作り置きのエリアのボタンから入れたときのエリアの名前。
// 前の形で作った旅を探し直すときは、area だけで頼む
export type TripAsk = { area?: string; start?: TripPoint; end?: TripPoint | null }
export const startJob = (trip: TripAsk, wish: string) =>
  getJson<JobState>('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...trip, wish, lang }) })
// プランを作ったときの頼み（調整の画面から、同じ旅で新しい候補を探すとき）
export const tripOf = (d: AreaData): TripAsk =>
  d.query?.start ? { area: d.query.area, start: d.query.start, end: d.query.end ?? null } : { area: d.query?.area || d.area.name }
// 点どうしの移動の表を作り直す（points は tablePoints の並び。ids は付けずに返る）。取れなければ null
export type Matrix = Omit<NonNullable<AreaData['matrix']>, 'ids'>
export const loadMatrix = (points: { lat: number; lng: number }[]) =>
  STATIC
    ? Promise.resolve(null)
    : getJson<{ matrix: Matrix | null }>('/api/matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: points.map((p) => [p.lng, p.lat]) }),
      })
        .then((d) => d.matrix)
        .catch(() => null)
export const pollJob = (id: string, after?: string) =>
  getJson<JobState>(`/api/jobs/${id}${after ? `?after=${encodeURIComponent(after)}` : ''}`)

// サーバーの無い公開版（GitHub Pages）では使えない機能を隠す
export const hasServer = !STATIC

// プランへの頼み（Gemini が画面の操作に置き換える）
export type AdjustOp =
  | { op: 'add' | 'remove'; id: string }
  | { op: 'stay'; id: string; minutes: number }
  | { op: 'move'; id: string; to: string }
  | { op: 'time'; start?: number; end?: number }
  | { op: 'cond'; add: { tag: string; label: string }[]; remove: string[] }
  | { op: 'district'; skip: string[]; use: string[] }
  | { op: 'find'; wish: string; kind: 'sight' | 'food' | 'cafe' }
  | { op: 'prefer'; moveLess?: boolean; calm?: boolean }
export type AdjustReply = { reply?: string; ops?: AdjustOp[]; error?: string }
export const askAdjust = (body: object) =>
  getJson<AdjustReply>('/api/adjust', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, lang }) })

// 旅のミッション（Gemini がその場所に合わせて 1 つ考える）
export const askOdai = (body: unknown) =>
  getJson<{ text?: string; error?: string }>('/api/odai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ペンギンの一言（プランに合わせた、その日に役立つ注意を Gemini が 3〜5 行）。枠に届いたときは 429 で例外
export const askPenguin = (facts: unknown, signal?: AbortSignal) =>
  getJson<{ lines?: string[]; error?: string }>('/api/penguin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, facts }),
    signal,
  })
