// Google のログイン（Firebase Authentication）。ログインは任意で、しなくても全部使える。
// Firebase の設定はサーバーが実行のときに /api/config で渡す。設定が無いとき（サーバーの無い公開版も）は、
// ログインの部品を出さず、Firebase の JS も読み込まない。
// ログインは signInWithPopup。iPhone の Safari は、押してから窓を開くまでの間に待ちがあると窓を止めるので、
// Firebase の JS は設定が届いた時点で先に読み込んでおき、押したらすぐに窓を開く。
// 名前・メールアドレス・アイコンは、画面に出すだけで、どこにも保存しない。
import { useEffect, useSyncExternalStore } from 'react'
import { hasServer } from './api'
import { loggedFetch } from './apiLog'
import { lang } from './i18n'
import type { Core } from './firebase'

export type FirebaseConfig = { apiKey: string; authDomain: string; projectId: string; appId: string; messagingSenderId?: string; storageBucket?: string }
export type Emulator = { auth: string; firestore: string }
type WebConfig = { firebase: FirebaseConfig | null; emulator?: Emulator }

// uid と、画面に出す名前だけ
export type AuthUser = { uid: string; name: string }
// available: ログインが使えるか（設定がある）。ready: ログインしているかどうかが分かった
export type AuthState = { available: boolean; ready: boolean; user: AuthUser | null }
export type SignInResult = 'ok' | 'cancelled' | 'blocked' | 'unsupported' | 'failed'

let state: AuthState = { available: false, ready: false, user: null }
const listeners = new Set<() => void>()
const set = (next: AuthState) => {
  if (next.available === state.available && next.ready === state.ready && next.user?.uid === state.user?.uid && next.user?.name === state.user?.name) return
  state = next
  listeners.forEach((f) => f())
}

let configP: Promise<WebConfig | null> | null = null
export function webConfig(): Promise<WebConfig | null> {
  configP ??= hasServer
    ? loggedFetch('/api/config')
        .then((r) => (r.ok ? (r.json() as Promise<WebConfig>) : null))
        .catch(() => null)
    : Promise.resolve(null)
  return configP
}

let core: Core | null = null
let coreP: Promise<Core | null> | null = null

// Firebase を用意する（設定が無い・読み込めないときは null）。何度呼んでも 1 回だけ
export function firebaseCore(): Promise<Core | null> {
  coreP ??= webConfig().then(async (c) => {
    if (!c?.firebase) {
      set({ available: false, ready: true, user: null })
      return null
    }
    set({ ...state, available: true })
    try {
      const m = await import('./firebase')
      core = m.init(c.firebase, c.emulator ?? null, lang)
      core.onUser((u) => set({ available: true, ready: true, user: u ? { uid: u.uid, name: u.displayName || '' } : null }))
      return core
    } catch {
      set({ available: false, ready: true, user: null })
      return null
    }
  })
  return coreP
}

export const authState = () => state
export function onAuthChange(f: () => void): () => void {
  listeners.add(f)
  return () => {
    listeners.delete(f)
  }
}

// 押したときに呼ぶ。窓を開く前に待たない（Firebase がまだ届いていないときだけは、届くのを待つ）
export function signIn(): Promise<SignInResult> {
  const c = core
  const run = (k: Core) =>
    k.signIn().then(
      (): SignInResult => 'ok',
      (e: unknown): SignInResult => {
        const code = (e as { code?: string })?.code ?? ''
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return 'cancelled'
        if (code === 'auth/popup-blocked') return 'blocked'
        if (code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/web-storage-unsupported') return 'unsupported'
        return 'failed'
      },
    )
  if (c) return run(c)
  return firebaseCore().then((k) => (k ? run(k) : 'failed'))
}

export async function signOut(): Promise<boolean> {
  const c = core ?? (await firebaseCore())
  if (!c) return false
  try {
    await c.signOut()
    return true
  } catch {
    return false
  }
}

// ログインの様子。最初に呼んだときに設定を聞き、設定があれば Firebase を読み込む
export function useAuth(): AuthState & { signIn: typeof signIn; signOut: typeof signOut } {
  const s = useSyncExternalStore(onAuthChange, authState, authState)
  useEffect(() => {
    void firebaseCore()
  }, [])
  return { ...s, signIn, signOut }
}
