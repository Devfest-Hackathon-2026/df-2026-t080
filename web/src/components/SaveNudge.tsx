import { Button } from '@astryxdesign/core/Button'
import { useState } from 'react'
import { closeNudge, isNudgeClosed } from '../lib/nudge'
import { tr } from '../lib/i18n'
import { useAccount } from './Account'
import { GoogleMark } from './GoogleMark'

const T = tr({
  ja: {
    text: 'この旅は、この端末にだけ保存されています。ログインすると、残せます。',
    signIn: 'Google でログイン',
    close: '閉じる',
  },
  en: {
    text: 'This trip is saved on this device only. Sign in to keep it.',
    signIn: 'Sign in with Google',
    close: 'Dismiss',
  },
})

// 旅を作った直後に、ログインしていない人へ出す。since は、その旅を作り始めた時刻
export function SaveNudge({ since }: { since: number }) {
  const { available, ready, user, busy, msg, onIn } = useAccount()
  const [closed, setClosed] = useState(() => isNudgeClosed(since))
  if (!available || !ready || user || closed) return null
  const close = () => {
    closeNudge(since)
    setClosed(true)
  }
  return (
    <section className="save-nudge" aria-label={T.text}>
      <p>{T.text}</p>
      <div className="save-nudge-actions">
        <Button variant="secondary" label={T.signIn} icon={<GoogleMark />} isDisabled={busy} onClick={onIn} />
        <Button variant="ghost" label={T.close} onClick={close} />
      </div>
      {msg && (
        <p className="note warn" role="status">
          {msg}
        </p>
      )}
    </section>
  )
}
