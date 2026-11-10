import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { MAX_TEXT, WHY_CHIPS } from '../lib/why'
import { tr } from '../lib/i18n'

const T = tr({
  ja: {
    chose: { title: '選んだ理由（任意）', group: '選んだ理由', input: '選んだ理由を一言' },
    want: { title: '行きたい理由（任意）', group: '行きたい理由', input: '行きたい理由を一言' },
    placeholder: '自分の言葉で一言',
  },
  en: {
    chose: { title: 'Your Reason (Optional)', group: 'Your reason', input: 'Your reason in a few words' },
    want: { title: 'Why You Want to Go (Optional)', group: 'Why you want to go', input: 'Why you want to go, in a few words' },
    placeholder: 'In your own words',
  },
})

export type WhyDraft = { chips: string[]; text: string }
export const WHY_SAVED = tr({ ja: '保存しました', en: 'Saved' })

// 選んだ理由を入れる欄（定型の理由を押して選ぶ＋一言）。保存は、使う側が行う。字数は打っている間だけ出す。
// want: まだプランに入れる前（見出しを「行きたい理由」にする）
// status: 欄の下に出す、保存の具合の一言（読み上げにも知らせる）
export function WhyField({ value, onChange, want = false, status = '' }: { value: WhyDraft; onChange: (v: WhyDraft) => void; want?: boolean; status?: string }) {
  const L = want ? T.want : T.chose
  const toggle = (chip: string) => {
    const has = value.chips.includes(chip)
    onChange({ ...value, chips: has ? value.chips.filter((c) => c !== chip) : [...value.chips, chip] })
  }
  return (
    <section className="why" aria-labelledby="why-title">
      <Heading level={3} id="why-title" className="sec-title">
        {L.title}
      </Heading>
      <div className="why-chips" role="group" aria-label={L.group}>
        {WHY_CHIPS.map((c) => (
          <ToggleButton key={c} className="why-chip" label={c} isPressed={value.chips.includes(c)} onPressedChange={() => toggle(c)} />
        ))}
      </div>
      <TextInput
        containerClassName="why-text"
        label={L.input}
        isLabelHidden
        value={value.text}
        placeholder={T.placeholder}
        onChange={(v) => onChange({ ...value, text: v.slice(0, MAX_TEXT) })}
      />
      {value.text.length > 0 && (
        <Text as="p" display="block" type="supporting" className="note why-count num">
          {value.text.length}/{MAX_TEXT}
        </Text>
      )}
      <p className="note why-status" role="status">
        {status}
      </p>
    </section>
  )
}
