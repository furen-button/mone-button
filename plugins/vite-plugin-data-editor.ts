import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

// dev サーバ専用: public/data/*.json の serif/ruby/memo/categories だけを書き戻すミドルウェア。
// apply: 'serve' のため本番ビルドには一切含まれない。

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(currentDir, '../public/data')

// serif/ruby/memo は文字列としてそのまま上書きする対象。
const EDITABLE_STRING_FIELDS = ['serif', 'ruby', 'memo'] as const

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

async function handleSave(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const payload = JSON.parse(await readBody(req)) as SavePayload

    const fileBaseName = payload.fileBaseName
    // パストラバーサル遮断: ファイル名に使える文字のみ許可（/ や .. を弾く）。
    if (typeof fileBaseName !== 'string' || !/^[\w.-]+$/.test(fileBaseName)) {
      sendJson(res, 400, { error: 'invalid fileBaseName' })
      return
    }

    const filePath = path.resolve(dataDir, `${fileBaseName}.json`)
    // 二重の安全策: 解決後の実パスが public/data 直下に収まることを確認。
    if (path.dirname(filePath) !== dataDir) {
      sendJson(res, 400, { error: 'path escapes data directory' })
      return
    }
    // 既存ファイルのみ編集可（新規作成はしない）。
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { error: 'file not found' })
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
    },
  }
}
