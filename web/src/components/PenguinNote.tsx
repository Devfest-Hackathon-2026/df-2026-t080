import { Card } from '@astryxdesign/core/Card'
import { PenguinMark } from './CrowdMark'
import { WeatherCredit } from './WeatherCredit'
import { tr } from '../lib/i18n'

const T = tr({
  ja: { title: 'ペンギンの一言', by: 'Gemini が作成' },
  en: { title: 'Penguin’s tips', by: 'Written by Gemini' },
})

// プランに合わせた、その日に役立つ注意（Gemini が書く）。天気も材料に使うので、天気の出典を添える。
// 見出しを押すと閉じる・開く（旅のミッションと同じ形）。閉じているときは見出しだけを出す
export function PenguinNote({ lines, open, onToggle }: { lines: string[]; open: boolean; onToggle: () => void }) {
  return (
    <Card className="penguin" role="region" aria-label={T.title} padding={4}>
      <div className="penguin-head">
        <button type="button" className="odai-toggle penguin-toggle" aria-expanded={open} aria-controls="penguin-body" onClick={onToggle}>
          <span className="penguin-title">
            <PenguinMark size={22} />
            {T.title}
          </span>
        </button>
      </div>
      <div id="penguin-body" hidden={!open}>
        <ul className="penguin-lines">
          {lines.map((l, i) => (
            <li key={`${i}:${l}`}>{l}</li>
          ))}
        </ul>
        <p className="penguin-by">{T.by}</p>
        <WeatherCredit />
      </div>
    </Card>
  )
}
