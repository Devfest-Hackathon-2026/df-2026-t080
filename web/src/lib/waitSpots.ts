// 候補を探している間の待ち画面に出す、エリアの見どころとお店（サーバーの仕事の preview）
import type { Spot } from '../types'
import type { JobPreview, PreviewSpot } from './api'

// 一度出した場所は、探し終わるまで入れ替えない。まだ出していない種類の場所だけを後ろに足す（上の行が動かないように）。
// 足す物が無ければ cur をそのまま返す。出す場所が無いときは null
export function keepPreview(cur: JobPreview | null, next: JobPreview | null | undefined): JobPreview | null {
  const ok = !!next?.area && !!next.places?.length
  if (!cur?.places.length) return ok ? next! : null
  if (!ok) return cur
  const groups = new Set(cur.places.map((p) => p.group))
  const ids = new Set(cur.places.map((p) => p.id))
  const added = next!.places.filter((p) => !groups.has(p.group) && !ids.has(p.id))
  return added.length ? { area: cur.area, places: [...cur.places, ...added] } : cur
}

// 見どころ（人気スポット・隠れた名所）とお店（飲食店・カフェ）に分ける（並びは、最初に出た順）
export function previewTopics(places: PreviewSpot[]): { topic: 'sights' | 'food'; places: PreviewSpot[] }[] {
  const out: { topic: 'sights' | 'food'; places: PreviewSpot[] }[] = []
  for (const p of places) {
    const topic = p.group === 'food' || p.group === 'cafe' ? 'food' : 'sights'
    const t = out.find((x) => x.topic === topic)
    if (t) t.places.push(p)
    else out.push({ topic, places: [p] })
  }
  return out
}

// 一覧の小さな写真（Thumb）に渡せる形にする。サーバーが送らない所は、表示に使わない決まった値で埋める
export function previewSpot(p: PreviewSpot): Spot {
  const { group, ...rest } = p
  return {
    ...rest,
    tags: p.tags ?? [],
    role: 'famous',
    source: group === 'hidden' ? 'hidden' : group === 'famous' ? 'famous' : 'food',
    stay: 0,
    open: 0,
    close: 24 * 60,
    crowd: [],
    weekdayDrop: 0,
    downside: '',
    basis: '',
  }
}

// 進み具合の丸の並び。済んだ段を済んだ順に左から並べ、残りは元の順のまま後ろに置く（並列に進んでも左から塗られる）。
// seen: これまでに済んだ段の順（この関数が足していく）
export function stepLine<S extends { key: string; state: string }>(steps: S[], seen: string[]): S[] {
  for (const s of steps) if (s.state === 'done' && !seen.includes(s.key)) seen.push(s.key)
  const done = seen.flatMap((k) => steps.filter((s) => s.key === k && s.state === 'done'))
  return [...done, ...steps.filter((s) => !done.includes(s))]
}
