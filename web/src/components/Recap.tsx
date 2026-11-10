import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AreaData, BusTrip } from '../types'
import { highlights, type Plan, type PlanInput, type UsualPlan } from '../lib/planner'
import { highlightParts } from '../lib/highlight'
import { goalOf } from '../lib/geo'
import { useTripOdai } from '../lib/odai'
import { RECAP_WORDS, buildRows, drawRecap, pad, recapInput, recapKey, rowSummary, type RecapRow } from '../lib/recap'
import { fmt } from '../lib/time'
import { useTripWhy, type Why } from '../lib/why'
import { Sheet } from './Sheet'
import { tr } from '../lib/i18n'
import { cardFileName, saveCard } from '../lib/cardImage'

const T = tr({
  ja: {
    failed: 'カードを作れませんでした',
    noRoom: '端末の空きが足りないため、保存できませんでした',
    shareTitle: (a: string) => `${a}の旅の振り返り`,
    empty: 'スケジュールの場所を押して「選んだ理由」を残すか、「旅のミッション」で写真を撮ると、その場所がカードに大きく載ります。',
    addWhy: (name: string) => `${name}を選んだ理由を残す`,
    ask: 'イメージと合っていましたか？',
    hitLabel: (n: string) => `${n}はイメージと合っていたか`,
    yes: '合っていた',
    no: 'イメージと違った',
    card: 'カード',
    alt: '旅の振り返りカード',
    making: 'カードを作っています……',
    save: '画像を保存・共有',
    local: '写真と理由は、この端末の中だけで扱い、サーバーには送りません。',
  },
  en: {
    failed: 'Couldn’t make the card',
    noRoom: 'Not enough storage to save',
    shareTitle: (a: string) => `${a} Trip Recap`,
    empty: 'Tap a place in your schedule to add your reason, or take a photo in Photo Mission, and that place will be featured on your card.',
    addWhy: (name: string) => `Add Your Reason for ${name}`,
    ask: 'Was it what you pictured?',
    hitLabel: (n: string) => `Was ${n} what you pictured?`,
    yes: 'As Pictured',
    no: 'Not as Pictured',
    card: 'Card',
    alt: 'Trip recap card',
    making: 'Making the card…',
    save: 'Save or Share Image',
    local: 'Photos and reasons stay on this device and are never sent to the server.',
  },
})

// 旅の振り返り。その日の流れを全部載せ、選んだ理由とミッションの写真のある場所を大きく出したカード（lib/recap.ts）を作り、画像で保存・共有できる。
// 「理由は当たったか」を 1 タップで残せる。理由とミッションはエリアごとに取ってあるので、since（この旅を作り始めた時刻）より後の分だけを、この旅の物として使う。
// まだ理由も写真も無いときは、カードの上に、最初の場所の「選んだ理由」へ進むボタンを出す（onWhy）。
// planDate: プランの日（ISO。プランの題に使う）。usual: よくある回り方（混雑の 1 行に使う）。buses: 区間ごとの見つけた便（区間の乗り物に使う）
export function Recap({
  area,
  date,
  planDate,
  data,
  input,
  plan,
  usual,
  buses,
  since,
  onClose,
  onNotice,
  onWhy,
}: {
  area: string
  date: string
  planDate: string
  data: AreaData
  input: PlanInput
  plan: Plan
  usual: UsualPlan | null
  buses: (BusTrip | undefined)[]
  since: number
  onClose: () => void
  onNotice: (text: string) => void
  onWhy?: (spotId: string) => void
}) {
  const { trip: whyTrip, get, put } = useTripWhy(area)
  const [odaiTrip] = useTripOdai(area)
  const whys = useMemo(() => whyTrip.items.filter((w) => w.at >= since), [whyTrip, since])
  const odai = useMemo(() => odaiTrip.items.filter((o) => o.at >= since), [odaiTrip, since])
  const rows = useMemo(() => buildRows(plan, whys, odai), [plan, whys, odai])
  const card = useMemo(() => {
    const title = highlightParts(highlights(data, plan, input), planDate, input.conds.map((c) => c.tag), input.conds)
    return recapInput({ area, date, title, start: data.start.name, goal: goalOf(data).name, plan, usual, buses, whys, odai })
  }, [area, date, planDate, data, input, plan, usual, buses, whys, odai])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const blob = useRef<Blob | null>(null)
  const urlRef = useRef('')

  // 載せる内容が変わったときだけ、描き直す（写真は長さだけで見分ける）
  const sig = recapKey(card)
  useEffect(() => {
    let alive = true
    const next = (u: string) => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = u
      setUrl(u)
    }
    if (!card.stops.length) {
      blob.current = null
      next('')
      return
    }
    setBusy(true)
    drawRecap(card)
      .then((b) => {
        if (!alive) return
        blob.current = b
        next(URL.createObjectURL(b))
      })
      .catch(() => alive && onNotice(T.failed))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  const setHit = (r: RecapRow, hit: NonNullable<Why['hit']>) => {
    const found = get(r.spotId)
    const cur = found && found.at >= since ? found : undefined
    const next = cur?.hit === hit ? undefined : hit
    const stop = plan.stops.find((s) => s.spot.id === r.spotId)
    const ok = put({ spotId: r.spotId, spotName: r.name, chips: cur?.chips ?? [], text: cur?.text ?? '', downsideSeen: cur?.downsideSeen ?? stop?.spot.downside ?? '', hit: next, at: cur?.at ?? Date.now() })
    if (!ok) onNotice(T.noRoom)
  }

  const save = () => {
    if (blob.current) void saveCard(blob.current, url, cardFileName(area), T.shareTitle(area))
  }

  return (
    <Sheet title={RECAP_WORDS.title} lead={RECAP_WORDS.when(area, date)} onClose={onClose}>
      {rows.length === 0 ? (
        <>
          <Text as="p" display="block" type="supporting" className="note">
            {T.empty}
          </Text>
          {onWhy && plan.stops[0] && (
            <div className="sheet-actions">
              <Button variant="secondary" size="lg" width="100%" className="recap-why" label={T.addWhy(plan.stops[0].spot.name)} onClick={() => onWhy(plan.stops[0].spot.id)} />
            </div>
          )}
        </>
      ) : (
        <section className="recap-list" aria-labelledby="recap-hit-title">
          <Heading level={3} id="recap-hit-title" className="sec-title">
            {T.ask}
          </Heading>
          <ul>
            {rows.map((r) => (
              <li key={r.spotId}>
                <div className="recap-head">
                  <span className="badge num">{pad(r.no)}</span>
                  <span className="recap-name">{r.name}</span>
                  <span className="muted num">{fmt(r.arrive)}</span>
                </div>
                <p className="recap-reason">{rowSummary(r)}</p>
                <div className="recap-hit" role="group" aria-label={T.hitLabel(r.name)}>
                  <ToggleButton className="why-chip" label={T.yes} isPressed={r.hit === 'yes'} onPressedChange={() => setHit(r, 'yes')} />
                  <ToggleButton className="why-chip" label={T.no} isPressed={r.hit === 'no'} onPressedChange={() => setHit(r, 'no')} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="recap-card" aria-labelledby="recap-card-title">
        <Heading level={3} id="recap-card-title" className="sec-title">
          {T.card}
        </Heading>
        {url ? (
          <img className="recap-img" src={url} alt={T.alt} width={1080} height={1920} />
        ) : (
          <Text as="p" display="block" type="supporting" className="note">
            {busy ? T.making : ''}
          </Text>
        )}
        <div className="sheet-actions">
          <Button variant="primary" size="lg" width="100%" label={T.save} isDisabled={!url || busy} onClick={save} />
        </div>
        <Text as="p" display="block" type="supporting" className="note">
          {T.local}
        </Text>
      </section>
    </Sheet>
  )
}
