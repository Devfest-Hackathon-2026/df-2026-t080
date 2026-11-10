import { Button } from '@astryxdesign/core/Button'
import { useEffect, useRef, useState } from 'react'
import type { Plan } from '../lib/planner'
import type { AreaData, BusTrip } from '../types'
import { RECAP_WORDS } from '../lib/recap'
import { drawPlanImage, imagePoints } from '../lib/planImage'
import { fetchLines, type LL } from './mapShared'
import { cardFileName, saveCard } from '../lib/cardImage'
import { Sheet } from './Sheet'
import { tr } from '../lib/i18n'

const T = tr({
  ja: {
    title: 'プランの画像',
    failed: '画像を作れませんでした',
    alt: 'プランの地図とスケジュール',
    making: '画像を作っています……',
    save: '画像を保存・共有',
    shareTitle: (a: string) => `${a}のプラン`,
  },
  en: {
    title: 'Plan Image',
    failed: 'Couldn’t make the image',
    alt: 'Map and schedule of the plan',
    making: 'Making the image…',
    save: 'Save or Share Image',
    shareTitle: (a: string) => `${a} Plan`,
  },
})

// プランの地図とスケジュールを 1 枚の画像にして、保存・共有する（旅の振り返りカードと同じ保存の仕方）
export function PlanImage({
  data,
  date,
  plan,
  buses,
  onClose,
  onNotice,
}: {
  data: AreaData
  date: string
  plan: Plan
  buses: (BusTrip | undefined)[]
  onClose: () => void
  onNotice: (text: string) => void
}) {
  const area = data.area.name
  const [url, setUrl] = useState('')
  const blob = useRef<Blob | null>(null)

  useEffect(() => {
    let alive = true
    let made = ''
    const start: LL = [data.start.lng, data.start.lat]
    const end = data.end ? { name: data.end.name, ll: [data.end.lng, data.end.lat] as LL } : null
    // 道に沿った線は、画像に描く位置（照合の前の位置）どうしで聞く
    const pts = imagePoints(start, plan, end?.ll)
    const legs = [...plan.stops.map((s) => s.leg), plan.back].map((leg, i) => ({ a: pts[i], b: pts[i + 1], mode: leg.mode }))
    const ask = legs.flatMap((l) => (l.a && l.b ? [{ a: l.a, b: l.b, mode: l.mode }] : []))
    fetchLines(ask)
      .then((got) => {
        let k = 0
        const lines = legs.map((l) => (l.a && l.b ? got[k++] : null))
        return drawPlanImage({ area, date, start: { name: data.start.name, ll: start }, end, plan, buses, lines })
      })
      .then((b) => {
        if (!alive) return
        blob.current = b
        made = URL.createObjectURL(b)
        setUrl(made)
      })
      .catch(() => alive && onNotice(T.failed))
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, date, plan, buses])

  const save = () => {
    if (blob.current) void saveCard(blob.current, url, cardFileName(area, 'plan'), T.shareTitle(area))
  }

  return (
    <Sheet title={T.title} lead={RECAP_WORDS.when(area, date)} onClose={onClose}>
      {url ? <img className="recap-img" src={url} alt={T.alt} /> : <p className="note">{T.making}</p>}
      <div className="sheet-actions">
        <Button variant="primary" size="lg" width="100%" label={T.save} isDisabled={!url} onClick={save} />
      </div>
    </Sheet>
  )
}
