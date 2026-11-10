// Firebase の本体（アプリとログイン）。重いので auth.ts から動的に読み込む（設定が無いときは読み込まない）
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type Auth, type User } from 'firebase/auth'
import type { Emulator, FirebaseConfig } from './auth'

export type Core = {
  app: FirebaseApp
  auth: Auth
  emulator: Emulator | null
  signIn: () => Promise<unknown>
  signOut: () => Promise<void>
  onUser: (f: (u: User | null) => void) => () => void
}

export function init(config: FirebaseConfig, emulator: Emulator | null, lang: string): Core {
  const app = initializeApp(config)
  const auth = getAuth(app)
  if (emulator) connectAuthEmulator(auth, emulator.auth, { disableWarnings: true })
  auth.languageCode = lang
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  return {
    app,
    auth,
    emulator,
    signIn: () => signInWithPopup(auth, provider),
    signOut: () => signOut(auth),
    onUser: (f) => onAuthStateChanged(auth, f),
  }
}
