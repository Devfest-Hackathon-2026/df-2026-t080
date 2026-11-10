import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { useState } from 'react'
import type { Plan } from '../lib/planner'
import { readTrip } from '../lib/why'
import { tr } from '../lib/i18n'
import { StopWhy } from './StopWhy'

const T = tr({
  ja: {
    title: '一番楽しみな場所は？',
    lead: '選んだ場所と理由は、旅のあとの振り返りで見返せます。',
    close: '閉じる',
    done: '完了',
  },
  en: {
    title: 'Which place are you looking forward to most?',
    lead: 'You can look back on it, and why, after the trip.',
    close: 'Dismiss',
    done: 'Done',
  },
})

// 場所を選ばずに作ったプランで、作った直後に 1 回だけ、一番楽しみな場所とその理由を聞く。
// 理由は場所の画面と同じ所に残す（振り返りカードも読む）。作ったときに理由が 1 つでも入っていれば、聞かない
// force: 本人が開き直したとき（理由が入っていても聞く）
export function FavAsk({ area, plan, since, force = false, onNotice, onClose }: { area: string; plan: Plan; since: number; force?: boolean; onNotice: (text: string) => void; onClose: () => void }) {
  const [ask] = useState(() => force || !readTrip(area).items.some((w) => w.at >= since))
  const [id, setId] = useState<string | null>(null)
  if (!ask || !plan.stops.length) return null
  const stop = plan.stops.find((s) => s.spot.id === id)
  return (
    <section className="fav-ask" aria-labelledby="fav-ask-title">
      <Heading level={2} id="fav-ask-title" className="sec-title">
        {T.title}
      </Heading>
      <Text as="p" display="block" type="supporting" className="note fav-ask-lead">
        {T.lead}
      </Text>
      <div className="toggles fav-ask-places" role="group" aria-labelledby="fav-ask-title">
        {plan.stops.map((s) => (
          <ToggleButton key={s.spot.id} label={s.spot.name} isPressed={s.spot.id === id} onPressedChange={() => setId(s.spot.id === id ? null : s.spot.id)} />
        ))}
      </div>
      {stop && <StopWhy area={area} spot={stop.spot} since={since} onNotice={onNotice} />}
      <div className="fav-ask-actions">
        <Button variant={stop ? 'secondary' : 'ghost'} label={stop ? T.done : T.close} onClick={onClose} />
      </div>
    </section>
  )
}
