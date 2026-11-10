import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { tr } from '../lib/i18n'

const T = tr({
  ja: { exTitle: (a: string) => `今は${a}の例です。`, own: '自分の旅を作る' },
  en: { exTitle: (a: string) => `This is an example for ${a}.`, own: 'Plan Your Trip' },
})

// 例のプランの画面の、自分の旅を作る入口（行きたい場所を選ぶ画面の例と同じ形）
export function DemoOwn({ area, onOwn }: { area: string; onOwn: () => void }) {
  return (
    <div className="sp-own demo-own">
      <Text as="p" display="block" type="supporting">
        {T.exTitle(area)}
      </Text>
      <Button variant="secondary" size="sm" label={T.own} onClick={onOwn} />
    </div>
  )
}
