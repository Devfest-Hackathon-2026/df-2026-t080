// API の呼び出しと返事を、ブラウザの開発者ツール（Console）に残す。
// 1 件ごとに「メソッド パス → 状態 時間」を出し、押すと開く中に、送った内容と返事の要約を入れる。
// 長い文字（写真のデータなど）や長い配列は縮める。状態の問い合わせ（/api/jobs/<id>）は、数が多いので debug レベル（Console の「Verbose」）に出す。
// 開発（vite dev）では出し、止めたいときは Console で localStorage.setItem('intentrip:apilog', '0') を実行して再読み込みする。
// 本番の組み立てでは出さず、見たいときは localStorage.setItem('intentrip:apilog', '1') を実行して再読み込みする。
let seq = 0
const POLL = /^\/api\/jobs\/[^/?]+/

function enabled(): boolean {
  try {
    const v = window.localStorage.getItem('intentrip:apilog')
    return import.meta.env.PROD ? v === '1' : v !== '0'
  } catch {
    return !import.meta.env.PROD
  }
}

// 中身の要約（長い文字・長い配列・深い入れ子を縮める）
function brief(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 120 ? `<${v.length} 文字>` : v
  if (Array.isArray(v)) {
    const head = v.slice(0, 5).map((x) => brief(x, depth + 1))
    return v.length > 5 ? [...head, `……（あと ${v.length - 5} 件）`] : head
  }
  if (v && typeof v === 'object') {
    if (depth >= 4) return '{…}'
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, brief(x, depth + 1)]))
  }
  return v
}

const BADGE = 'background:#0d8492;color:#fff;padding:1px 6px;border-radius:4px;font-weight:700'
const bad = (status: number, body: unknown) => status >= 400 || (!!body && typeof body === 'object' && 'error' in (body as object))

function emit(id: number, line: string, status: number, request: unknown, response: unknown) {
  const warn = bad(status, response)
  const open = warn ? console.group : console.groupCollapsed // 失敗は開いたまま出す
  open.call(console, `%c#${id}%c ${line}`, BADGE, warn ? 'color:#c4421b;font-weight:700' : '')
  if (request !== undefined) console.log('送った内容', request)
  if (response !== undefined) console.log('返事', response)
  console.groupEnd()
}

// fetch と同じ使い方。呼び出しと返事を Console に残す
export async function loggedFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!enabled()) return fetch(url, init)
  const id = ++seq
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.startsWith(window.location.origin) ? url.slice(window.location.origin.length) : url
  const label = `${method} ${path.length > 140 ? path.slice(0, 140) + '…' : path}`
  const quiet = method === 'GET' && POLL.test(path)
  let request: unknown
  if (typeof init?.body === 'string') {
    try {
      request = brief(JSON.parse(init.body))
    } catch {
      request = `<${init.body.length} 文字>`
    }
  }
  const t0 = performance.now()
  try {
    const r = await fetch(url, init)
    const ms = Math.round(performance.now() - t0)
    const line = `${label} → ${r.status} ${ms}ms`
    const json = (r.headers.get('content-type') ?? '').includes('json')
    if (quiet && r.ok) {
      console.debug(`[api] #${id} ${line}`)
    } else if (json) {
      r.clone()
        .json()
        .then(
          (b) => emit(id, line, r.status, request, brief(b)),
          () => emit(id, line, r.status, request, undefined),
        )
    } else {
      emit(id, line, r.status, request, undefined)
    }
    return r
  } catch (e) {
    const ms = Math.round(performance.now() - t0)
    if (e instanceof DOMException && e.name === 'AbortError') {
      console.debug(`[api] #${id} ${label} → 取り消し ${ms}ms`)
      throw e
    }
    console.error(`[api] #${id} ${label} → 失敗（${e instanceof Error ? e.name : '不明'}）${ms}ms`, { 送った内容: request, 原因: e })
    throw e
  }
}
