import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getDatabase, ref, update, onValue, increment, type Database } from 'firebase/database'

type FirebaseEnvConfig = {
  apiKey: string
  authDomain?: string
  databaseURL: string
  projectId?: string
  appId?: string
}

function getFirebaseConfig(): FirebaseEnvConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim()
  const databaseURL = import.meta.env.VITE_FIREBASE_DATABASE_URL?.trim()

  if (!apiKey || !databaseURL) {
    return null
  }

  return {
    apiKey,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || undefined,
    databaseURL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || undefined,
    appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() || undefined,
  }
}

export function isPlayCountConfigured(): boolean {
  return getFirebaseConfig() !== null && typeof window !== 'undefined'
}

let app: FirebaseApp | null = null
let database: Database | null = null

function getDb(): Database | null {
  if (!isPlayCountConfigured()) {
    return null
  }

  if (database) {
    return database
  }

  const config = getFirebaseConfig()
  if (!config) {
    return null
  }

  if (!app) {
    app = initializeApp(config)
  }
  database = getDatabase(app)
  return database
}

const TOTAL_PLAYS_PATH = 'stats/totalPlays'
const PER_CLIP_PATH = 'stats/perClip'

/**
/**
 * dev では本番カウンターを汚さないため、既定で書き込みをスキップする。
 * ローカルで書き込みを試したい場合は `.env.local` に
 * `VITE_PLAY_COUNT_DEV_WRITE=true` を設定する。
 */
function canWrite(): boolean {
  if (!import.meta.env.DEV) {
    return true
  }
  return import.meta.env.VITE_PLAY_COUNT_DEV_WRITE === 'true'
}

/**
 * 再生回数をサーバー側で atomic に +1 する（総数 + ボイス別）。
 * 計測失敗が再生を妨げないよう fire-and-forget。
 */
export function incrementPlayCount(fileBaseName: string): void {
  if (!canWrite()) {
    return
  }

  const db = getDb()
  if (!db) {
    return
  }

  update(ref(db), {
    [TOTAL_PLAYS_PATH]: increment(1),
    [`${PER_CLIP_PATH}/${fileBaseName}`]: increment(1),
  }).catch((error) => {
    if (import.meta.env.DEV) {
      console.warn('[playCount] write failed', error)
    }
  })
}

/**
 * 総再生回数を購読する。解除関数を返す。
 */
export function subscribePlayCount(callback: (total: number) => void): () => void {
  const db = getDb()
  if (!db) {
    return () => {}
  }

  return onValue(
    ref(db, TOTAL_PLAYS_PATH),
    (snapshot) => {
      const value = snapshot.val()
      callback(typeof value === 'number' ? value : 0)
    },
    (error) => {
      if (import.meta.env.DEV) {
        console.warn('[playCount] read totalPlays failed', error)
      }
    },
  )
}

/**
 * ボイス別の再生回数 map 全体を購読する。解除関数を返す。
 */
export function subscribePerClipCounts(callback: (counts: Record<string, number>) => void): () => void {
  const db = getDb()
  if (!db) {
    return () => {}
  }

  return onValue(
    ref(db, PER_CLIP_PATH),
    (snapshot) => {
      const value = snapshot.val()
      callback(value && typeof value === 'object' ? (value as Record<string, number>) : {})
    },
    (error) => {
      if (import.meta.env.DEV) {
        console.warn('[playCount] read perClip failed', error)
      }
    },
  )
}
