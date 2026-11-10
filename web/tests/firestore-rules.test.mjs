// firestore.rules の試験（本人の旅だけを読み書きでき、ほかの人の旅は読めない・書けない）。
// Emulator Suite（Auth と Firestore）を相手に動かす。リポジトリの一番上で:
//   firebase emulators:exec --only auth,firestore --project demo-intentrip "node --test web/tests/firestore-rules.test.mjs"
// Emulator の住所（FIRESTORE_EMULATOR_HOST・FIREBASE_AUTH_EMULATOR_HOST）が無いときは飛ばす。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import {
  collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, limit, orderBy, query, setDoc, terminate, updateDoc,
} from 'firebase/firestore'

const STORE = process.env.FIRESTORE_EMULATOR_HOST
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST
const skip = !STORE || !AUTH ? 'Emulator が動いていない' : false
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-intentrip'

const apps = []
async function client(name, who) {
  const app = initializeApp({ apiKey: 'demo-key', authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, appId: '1:1:web:1' }, name)
  apps.push(app)
  const auth = getAuth(app)
  connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true })
  const db = getFirestore(app)
  const [host, port] = STORE.split(':')
  connectFirestoreEmulator(db, host, Number(port))
  let uid = null
  if (who) {
    const cred = GoogleAuthProvider.credential(JSON.stringify({ sub: who, email: `${who}@example.com`, email_verified: true }))
    uid = (await signInWithCredential(auth, cred)).user.uid
  }
  return { db, uid }
}

const trip = (over = {}) => ({
  v: 1, title: '京都', area: '京都', date: '2026-11-14', createdAt: 1, updatedAt: 2, stops: 5, lang: 'ja', since: 1,
  state: JSON.stringify({ data: { places: [] } }), why: '[]', odai: '[]', ...over,
})
const denied = async (p) => {
  await assert.rejects(p, (e) => e?.code === 'permission-denied')
}
const ref = (db, uid, id) => doc(db, 'users', uid, 'trips', id)

test('本人は自分の旅を作る・読む・一覧する・直す・消すことができる', { skip }, async () => {
  const a = await client('a1', 'alice')
  await setDoc(ref(a.db, a.uid, 'tripAAAA0001'), trip())
  assert.equal((await getDoc(ref(a.db, a.uid, 'tripAAAA0001'))).data().title, '京都')
  const list = await getDocs(query(collection(a.db, 'users', a.uid, 'trips'), orderBy('updatedAt', 'desc'), limit(50)))
  assert.ok(list.docs.some((d) => d.id === 'tripAAAA0001'))
  await setDoc(ref(a.db, a.uid, 'tripAAAA0001'), trip({ updatedAt: 3, title: '京都の旅' }))
  await deleteDoc(ref(a.db, a.uid, 'tripAAAA0001'))
  assert.equal((await getDoc(ref(a.db, a.uid, 'tripAAAA0001'))).exists(), false)
})

test('ほかの人の旅は読めない・一覧できない・書けない・消せない', { skip }, async () => {
  const a = await client('a2', 'alice')
  const b = await client('b2', 'bob')
  assert.notEqual(a.uid, b.uid)
  await setDoc(ref(a.db, a.uid, 'tripAAAA0002'), trip())
  await denied(getDoc(ref(b.db, a.uid, 'tripAAAA0002')))
  await denied(getDocs(query(collection(b.db, 'users', a.uid, 'trips'), limit(50))))
  await denied(setDoc(ref(b.db, a.uid, 'tripAAAA0002'), trip({ title: '書き換え' })))
  await denied(setDoc(ref(b.db, a.uid, 'tripBBBB0002'), trip()))
  await denied(deleteDoc(ref(b.db, a.uid, 'tripAAAA0002')))
  assert.equal((await getDoc(ref(a.db, a.uid, 'tripAAAA0002'))).data().title, '京都')
})

test('ログインしていないと、だれの旅も読めない・書けない', { skip }, async () => {
  const a = await client('a3', 'alice')
  const n = await client('n3', null)
  await setDoc(ref(a.db, a.uid, 'tripAAAA0003'), trip())
  await denied(getDoc(ref(n.db, a.uid, 'tripAAAA0003')))
  await denied(setDoc(ref(n.db, a.uid, 'tripNNNN0003'), trip()))
})

test('決まった項目と大きさでないと書けない', { skip }, async () => {
  const a = await client('a4', 'alice')
  const r = ref(a.db, a.uid, 'tripAAAA0004')
  await denied(setDoc(r, trip({ email: 'alice@example.com' })))
  await denied(setDoc(r, trip({ name: 'Alice' })))
  const { odai: _o, ...short } = trip()
  await denied(setDoc(r, short))
  await denied(setDoc(r, trip({ state: 'x'.repeat(900001) })))
  await denied(setDoc(r, trip({ why: 'x'.repeat(60001) })))
  await denied(setDoc(r, trip({ stops: 101 })))
  await denied(setDoc(r, trip({ lang: 'fr' })))
  await denied(setDoc(r, trip({ date: '11/14' })))
  await denied(setDoc(ref(a.db, a.uid, 'short'), trip()))
  await setDoc(r, trip())
  await denied(updateDoc(r, { createdAt: 99 }))
  await denied(getDocs(query(collection(a.db, 'users', a.uid, 'trips'), limit(51))))
  await denied(getDocs(query(collection(a.db, 'users', a.uid, 'trips'))))
})

test('旅のほかの場所は、本人でも読めない・書けない', { skip }, async () => {
  const a = await client('a5', 'alice')
  await denied(setDoc(doc(a.db, 'users', a.uid), { name: 'Alice' }))
  await denied(getDoc(doc(a.db, 'users', a.uid)))
  await denied(setDoc(doc(a.db, 'shared', 'x'), { a: 1 }))
})

test.after(async () => {
  for (const app of apps) {
    await terminate(getFirestore(app)).catch(() => {})
    await deleteApp(app).catch(() => {})
  }
})
