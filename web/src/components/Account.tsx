import { Button } from '@astryxdesign/core/Button'
import { useState, type ReactNode } from 'react'
import { useAuth, type SignInResult } from '../lib/auth'
import { tr } from '../lib/i18n'
import { LangSwitch } from './LangSwitch'
import { GoogleMark } from './GoogleMark'

const T = tr({
  ja: {
    signIn: 'Google でログイン',
    signOut: 'ログアウト',
    who: (n: string) => (n ? `ログイン中：${n}` : 'ログイン中'),
    blocked: 'ログインの画面が開けませんでした。もう一度押してください。',
    unsupported: 'このブラウザではログインできません。Safari か Chrome で開いてください。',
    failed: 'ログインできませんでした。もう一度お試しください。',
    outFailed: 'ログアウトできませんでした。もう一度お試しください。',
  },
  en: {
    signIn: 'Sign in with Google',
    signOut: 'Sign Out',
    who: (n: string) => (n ? `Signed in as ${n}` : 'Signed in'),
    blocked: 'The sign-in window couldn’t open. Please tap again.',
    unsupported: 'You can’t sign in on this browser. Open the page in Safari or Chrome.',
    failed: 'Couldn’t sign in. Please try again.',
    outFailed: 'Couldn’t sign out. Please try again.',
  },
})

const MESSAGE: Record<SignInResult, string> = { ok: '', cancelled: '', blocked: T.blocked, unsupported: T.unsupported, failed: T.failed }

export const ACCOUNT_TEXT = T

// ログイン・ログアウトの押したときの処理と、うまくいかなかったときの一言（調整のシートとホーム画面で使う）。
// onIn は、押したときの処理の中でそのまま呼ぶ（signIn を await の前に呼ぶため）
export function useAccount() {
  const auth = useAuth()
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const onIn = () => {
    setMsg('')
    setBusy(true)
    void auth.signIn().then((r) => {
      setBusy(false)
      setMsg(MESSAGE[r])
    })
  }
  const onOut = () => {
    setMsg('')
    void auth.signOut().then((ok) => setMsg(ok ? '' : T.outFailed))
  }
  return { ...auth, busy, msg, onIn, onOut }
}

// 調整のシートの一番下の、ログインと言語の切り替え。ログインが使えないとき（設定が無いとき）は言語の切り替えだけ
export function AccountRow({ children }: { children?: ReactNode }) {
  const { available, user, ready, busy, msg, onIn, onOut } = useAccount()
  if (!available) {
    return (
      <>
        {children && <div className="sheet-actions">{children}</div>}
        <div className="sheet-actions account">
          <LangSwitch variant="secondary" wide />
        </div>
      </>
    )
  }
  return (
    <>
      {children && <div className="sheet-actions">{children}</div>}
      <div className="sheet-actions account">
        {user ? (
          <Button variant="secondary" size="lg" width="100%" label={T.signOut} onClick={onOut} />
        ) : (
          <Button variant="secondary" size="lg" width="100%" label={T.signIn} icon={<GoogleMark />} isDisabled={!ready || busy} onClick={onIn} />
        )}
        <LangSwitch variant="secondary" wide />
      </div>
      {user && <p className="note account-who">{T.who(user.name)}</p>}
      {msg && (
        <p className="note warn" role="status">
          {msg}
        </p>
      )}
    </>
  )
}
