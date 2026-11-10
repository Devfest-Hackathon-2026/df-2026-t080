// 「この付近で検索」: 地図に写っている範囲の中だけを、サーバー経由で Google Places の Text Search で探す。
// 結果は Places の内容なので取っておかない（画面に出している間だけ持つ）。Google の地図を出しているときだけ使う
import { hasServer } from './api'
import { loggedFetch } from './apiLog'
import { lang } from './i18n'
import type { Period } from './hours'
import type { Kind } from '../types'

// kind: 候補の種類（サーバーが Places の種類から分ける）。hours: 曜日ごとの営業時間（分からなければ null）
export type Found = { id: string; name: string; lat: number; lng: number; type: string; kind: Kind; rating: number | null; count: number | null; hours: Period[] | null }
// 範囲（南, 西, 北, 東）
export type AreaBox = [number, number, number, number]
export type FoundError = 'wide' | 'limit' | 'unavailable' | 'offline'
export type FoundReply = { places: Found[] } | { error: FoundError }

export async function searchArea(q: string, box: AreaBox): Promise<FoundReply> {
  if (!hasServer) return { error: 'unavailable' }
  try {
    const r = await loggedFetch('/api/area-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, box, lang }),
    })
    const j = (await r.json().catch(() => ({}))) as { places?: Found[]; error?: string }
    if (r.ok && Array.isArray(j.places)) return { places: j.places }
    if (j.error === 'wide') return { error: 'wide' }
    if (j.error === 'limit' || r.status === 429) return { error: 'limit' }
    return { error: 'unavailable' }
  } catch {
    return { error: 'offline' }
  }
}
