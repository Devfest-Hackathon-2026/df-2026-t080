import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { PenguinMark } from './CrowdMark'
import { WeatherCredit } from './WeatherCredit'
import { tr } from '../lib/i18n'

const T = tr({
  ja: { title: 'ペンギンの一言', close: '閉じる', closeLabel: 'ペンギンの一言を閉じる', by: 'Gemini が書きました' },
  en: { title: 'Penguin’s tips', close: 'Close', closeLabel: 'Close Penguin’s tips', by: 'Written by Gemini' },
})

// プランに合わせた、その日に役立つ注意（Gemini が書く）。天気も材料に使うので、天気の出典を添える
export function PenguinNote({ lines, onClose }: { lines: string[]; onClose: () => void }) {
  return (
    <Card className="penguin" role="region" aria-label={T.title} padding={4}>
      <div className="penguin-head">
        <PenguinMark size={22} />
        <span className="penguin-title">{T.title}</span>
        <Button variant="ghost" className="penguin-close" label={T.closeLabel} onClick={onClose}>
          {T.close}
        </Button>
      </div>
      <ul className="penguin-lines">
        {lines.map((l, i) => (
          <li key={`${i}:${l}`}>{l}</li>
        ))}
      </ul>
      <p className="penguin-by">{T.by}</p>
      <WeatherCredit />
    </Card>
  )
}
