import { useState } from 'react'
import type { Spot } from '../types'
import { useTripWhy } from '../lib/why'
import { WHY_SAVED, WhyField, type WhyDraft } from './WhyField'
import { tr } from '../lib/i18n'

// プランにある場所の「選んだ理由」。入れた・直したらすぐ、このブラウザに保存する。since より前に入れた理由（前の旅の分）は出さない
export function StopWhy({ area, spot, since, onNotice }: { area: string; spot: Spot; since: number; onNotice: (text: string) => void }) {
  const { get, put } = useTripWhy(area)
  const found = get(spot.id)
  const saved = found && found.at >= since ? found : undefined
  const value: WhyDraft = { chips: saved?.chips ?? [], text: saved?.text ?? '' }
  const [stored, setStored] = useState(false)
  const change = (v: WhyDraft) => {
    const ok = put({ spotId: spot.id, spotName: spot.name, chips: v.chips, text: v.text, downsideSeen: saved?.downsideSeen ?? spot.downside, hit: saved?.hit, at: saved?.at ?? Date.now() })
    if (!ok) onNotice(tr({ ja: '端末の空きが足りないため、理由を保存できませんでした', en: 'Not enough storage to save your reason' }))
    setStored(ok)
  }
  return <WhyField value={value} onChange={change} status={stored ? WHY_SAVED : ''} />
}
