import { Card } from '@astryxdesign/core/Card'
import type { Wear, WearNote } from '../lib/weather'
import { tr } from '../lib/i18n'
import { WeatherCredit } from './WeatherCredit'

const T = tr({
  ja: { title: '服装の目安', feels: (a: number, b: number) => `体感 ${a}℃〜${b}℃` },
  en: { title: 'What to wear', feels: (a: number, b: number) => `Feels like ${a}–${b}℃` },
})

// 服装・体感温度・ひと言に添える印（線のアイコン・色は文字と同じ）。
// 形の出典: Lucide（https://lucide.dev・lucide-react v0.469.0）の shirt・thermometer・umbrella・layers・droplet。
// ISC ライセンス（https://lucide.dev/license）。著作権は Lucide Contributors にあり、一部は Feather（MIT・Cole Bemis）に由来する。
type Mark = 'shirt' | 'thermometer' | WearNote['icon']
const SHAPES: Record<Mark, string[]> = {
  shirt: ['M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z'],
  thermometer: ['M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z'],
  umbrella: ['M22 12a10.06 10.06 1 0 0-20 0Z', 'M12 12v8a2 2 0 0 0 4 0', 'M12 2v1'],
  layers: [
    'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
    'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12',
    'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17',
  ],
  water: ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'],
}

function WearIcon({ mark, size = 18 }: { mark: Mark; size?: number }) {
  return (
    <svg className="wear-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {SHAPES[mark].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

// 服装の目安（予定の時間帯の体感温度から）
export function WearCard({ wear }: { wear: Wear }) {
  return (
    <Card className="wear" role="region" aria-label={T.title} padding={4}>
      <div className="wear-main">
        <span className="wear-label">{T.title}</span>
        <span className="wear-text">
          <WearIcon mark="shirt" size={20} />
          {wear.label}
        </span>
        {wear.feels.every(Number.isFinite) && (
          <span className="wear-feels num">
            <WearIcon mark="thermometer" />
            {T.feels(wear.feels[0], wear.feels[1])}
          </span>
        )}
      </div>
      {wear.notes.length > 0 && (
        <ul className="wear-notes">
          {wear.notes.map((n) => (
            <li key={n.text}>
              <WearIcon mark={n.icon} size={16} />
              {n.text}
            </li>
          ))}
        </ul>
      )}
      <WeatherCredit />
    </Card>
  )
}
