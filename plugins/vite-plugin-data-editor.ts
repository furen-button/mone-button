import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

// dev サーバ専用: public/data/*.json の serif/ruby/memo/categories を書き戻すミドルウェアと、
// クリップ（json + mp4）を trash/ へ退避する削除ミドルウェア。
// apply: 'serve' のため本番ビルドには一切含まれない。

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(currentDir, '../public/data')
const videosDir = path.resolve(currentDir, '../public/videos')
// 削除は完全消去ではなく trash/ への移動（誤削除時に手で戻せるようにする）。
const trashDir = path.resolve(currentDir, '../trash')

// serif/ruby/memo は文字列としてそのまま上書きする対象。
const EDITABLE_STRING_FIELDS = ['serif', 'ruby', 'memo'] as const

type DeletePayload = {
  fileBaseName?: unknown
}

type SavePayload = {
  fileBaseName?: unknown
  serif?: unknown
  ruby?: unknown
  memo?: unknown
  categories?: unknown
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

// fileBaseName を検証し public/data 直下の既存 json パスを返す。不正時はレスポンスを返して null。
function resolveDataFile(fileBaseName: unknown, res: ServerResponse): string | null {
  // パストラバーサル遮断: ファイル名に使える文字のみ許可（/ や .. を弾く）。
  if (typeof fileBaseName !== 'string' || !/^[\w.-]+$/.test(fileBaseName)) {
    sendJson(res, 400, { error: 'invalid fileBaseName' })
    return null
  }

  const filePath = path.resolve(dataDir, `${fileBaseName}.json`)
  // 二重の安全策: 解決後の実パスが public/data 直下に収まることを確認。
  if (path.dirname(filePath) !== dataDir) {
    sendJson(res, 400, { error: 'path escapes data directory' })
    return null
  }
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: 'file not found' })
    return null
  }
  return filePath
}

// 同名ファイルが既に trash にあっても上書きしないよう、衝突時はタイムスタンプを付ける。
function moveToTrash(sourcePath: string, subDir: string): string {
  const destDir = path.join(trashDir, subDir)
  fs.mkdirSync(destDir, { recursive: true })

  const { name, ext } = path.parse(sourcePath)
  let destPath = path.join(destDir, `${name}${ext}`)
  if (fs.existsSync(destPath)) {
    destPath = path.join(destDir, `${name}.${Date.now()}${ext}`)
  }
  fs.renameSync(sourcePath, destPath)
  return path.relative(path.dirname(trashDir), destPath)
}

async function handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const payload = JSON.parse(await readBody(req)) as DeletePayload
    const filePath = resolveDataFile(payload.fileBaseName, res)
    if (!filePath) {
      return
    }

    const moved = [moveToTrash(filePath, 'data')]
    // mp4 は未DLの場合もあるので、存在すれば一緒に退避する。
    const videoPath = path.join(videosDir, `${payload.fileBaseName as string}.mp4`)
    if (fs.existsSync(videoPath)) {
      moved.push(moveToTrash(videoPath, 'videos'))
    }

    sendJson(res, 200, { moved })
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function handleSave(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const payload = JSON.parse(await readBody(req)) as SavePayload

    // 既存ファイルのみ編集可（新規作成はしない）。
    const filePath = resolveDataFile(payload.fileBaseName, res)
    if (!filePath) {
      return
    }

    const current = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>

    for (const field of EDITABLE_STRING_FIELDS) {
      const value = payload[field]
      if (typeof value === 'string') {
        current[field] = value
      }
    }

    if (Array.isArray(payload.categories)) {
      current.categories = payload.categories
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    }

    // extract.js と同じフォーマット（2スペースインデント）で書き戻し、差分を最小化する。
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2))
    sendJson(res, 200, current)
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

export function dataEditorPlugin(): Plugin {
  return {
    name: 'mone-data-editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__data/save', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        void handleSave(req, res)
      })
      server.middlewares.use('/__data/delete', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        void handleDelete(req, res)
      })
    },
  }
}
