import { Fragment } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import type { AreaData } from '../types'
import { highlights, type Plan, type PlanInput } from '../lib/planner'
import { daysUntil, highlightParts } from '../lib/highlight'
import { isEn, tr } from '../lib/i18n'

const T = tr({
  ja: { tomorrow: '出発は明日', days: (n: number) => `出発まで あと${n}日` },
  en: { tomorrow: 'Leaving tomorrow', days: (n: number) => `${n} days to go` },
})

// プランの上に出す、その日の楽しみの 1 行（プランの題）。プランの日が先なら、その上に出発まであと何日かを出す
export function LookForward({ data, plan, input, date }: { data: AreaData; plan: Plan; input: PlanInput; date: string }) {
  const parts = highlightParts(highlights(data, plan, input), date, input.conds.map((c) => c.tag), input.conds)
  if (!parts.length) return null
  const days = daysUntil(date)
  return (
    <p className="hope">
      {days > 0 && (
        <span className="hope-days num">
          <Badge variant="neutral" label={days === 1 ? T.tomorrow : T.days(days)} />
        </span>
      )}
      <span className="hope-text">
        {parts.map((p, i) => (
          <Fragment key={p}>
            {isEn && i > 0 && ' '}
            <span>{p}</span>
          </Fragment>
        ))}
      </span>
    </p>
  )
}
