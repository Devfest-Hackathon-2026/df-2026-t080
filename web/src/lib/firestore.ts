// Firestore の本体。重いので trips.ts から動的に読み込む（ログインしているときだけ）
import { collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, limit, onSnapshot, orderBy, query, setDoc, type DocumentData, type Firestore } from 'firebase/firestore'
import type { Core } from './firebase'

// 一覧に出す旅の数の上限（ルールでも同じ数までに絞る）
export const LIST_MAX = 50

export type Store = {
  get: (uid: string, id: string) => Promise<DocumentData | null>
  set: (uid: string, id: string, data: DocumentData) => Promise<void>
  remove: (uid: string, id: string) => Promise<void>
  list: (uid: string) => Promise<{ id: string; data: DocumentData }[]>
  watch: (uid: string, f: (rows: { id: string; data: DocumentData }[]) => void, onError: () => void) => () => void
}

export function init(core: Core): Store {
  const db: Firestore = getFirestore(core.app)
  if (core.emulator) {
    const [host, port] = core.emulator.firestore.split(':')
    connectFirestoreEmulator(db, host, Number(port))
  }
  const trips = (uid: string) => collection(db, 'users', uid, 'trips')
  const newest = (uid: string) => query(trips(uid), orderBy('updatedAt', 'desc'), limit(LIST_MAX))
  return {
    get: async (uid, id) => {
      const d = await getDoc(doc(trips(uid), id))
      return d.exists() ? d.data() : null
    },
    set: (uid, id, data) => setDoc(doc(trips(uid), id), data),
    remove: (uid, id) => deleteDoc(doc(trips(uid), id)),
    list: async (uid) => (await getDocs(newest(uid))).docs.map((d) => ({ id: d.id, data: d.data() })),
    watch: (uid, f, onError) => onSnapshot(newest(uid), (q) => f(q.docs.map((d) => ({ id: d.id, data: d.data() }))), onError),
  }
}
