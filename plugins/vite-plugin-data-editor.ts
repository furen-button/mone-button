import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin } from 'vite'
import { resolveWhisperConfig, toRuby, transcribeFile } from '../scripts/dev-server/lib/transcribe.js'
import { assertLocalRequest, readBody, sendJson } from './lib/dev-http'
import {
  TrimValidationError,
  createExcerptPlan,
  createExtendPlan,
  createTrimPlan,
  parseExtendPayload,
  parseTrimPayload,
} from '../scripts/dev-server/lib/trim.js'
import { normalizeReview } from '../scripts/dev-server/lib/clip-review.js'
import { loudnessGain, measureLoudness, volumeFilter } from '../scripts/dev-server/lib/loudness.js'
import type { LoudnessGain, LoudnessMeasurement } from '../scripts/dev-server/lib/loudness.js'
import { applyCameraPatch } from '../scripts/create-video/camera.js'

// dev サーバ専用: public/data/*.json の serif/ruby/memo/categories を書き戻すミドルウェアと、
// クリップ（json + mp4）の削除・トリム・切り出し・範囲拡張（YouTube から取り直し）と、ローカル音声の文字起こし・読み生成、
// 要対応バッジ用の mp4 一覧。
// apply: 'serve' のため本番ビルドには一切含まれない。

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(currentDir, '../public/data')
const videosDir = path.resolve(currentDir, '../public/videos')
// 削除は完全消去ではなく trash/ への移動（誤削除時に手で戻せるようにする）。
const trashDir = path.resolve(currentDir, '../trash')
// 範囲拡張の取り直し先。public/ に置くと途中で止まったファイルが build に混ざるので cache/ に置く。
const extendTmpDir = path.resolve(currentDir, '../cache/clip-extend')
const downloadScript = path.resolve(currentDir, '../scripts/download.js')

// serif/ruby/memo は文字列としてそのまま上書きする対象。
const EDITABLE_STRING_FIELDS = ['serif', 'ruby', 'memo'] as const

type DeletePayload = {
  fileBaseName?: unknown
}

type TrimPayload = {
  fileBaseName?: unknown
  keepStart?: unknown
  keepEnd?: unknown
}

type SavePayload = {
  fileBaseName?: unknown
  serif?: unknown
  ruby?: unknown
  memo?: unknown
  categories?: unknown
  review?: unknown
  // 切り出しツールのキーフレーム。{ aspect, keyframes } で effects.camera[aspect] だけを書き換える（null で消す）。
  camera?: unknown
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

type FfmpegTools = {
  ffmpeg: string
  ffprobe: string
}

type FfmpegModule = {
  AUDIO_RESAMPLE: string
  resolveFfmpeg: () => FfmpegTools
  probeDuration: (ffprobe: string, filePath: string) => number
}

type AssetsModule = {
  cacheRoot: string
}

function execFileAsync(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }))
        return
      }
      resolve()
    })
  })
}

async function loadFfmpegModules(): Promise<{ ffmpegModule: FfmpegModule, assetsModule: AssetsModule }> {
  const [ffmpegModule, assetsModule] = await Promise.all([
    import(pathToFileURL(path.resolve(currentDir, '../scripts/create-video/ffmpeg.js')).href),
    import(pathToFileURL(path.resolve(currentDir, '../scripts/create-video/assets.js')).href),
  ])
  return {
    ffmpegModule: ffmpegModule as FfmpegModule,
    assetsModule: assetsModule as AssetsModule,
  }
}

async function encodeRange({
  ffmpeg,
  audioResample,
  sourcePath,
  destPath,
  beforeRename,
  keepStart,
  keepEnd,
}: {
  ffmpeg: string
  audioResample: string
  sourcePath: string
  destPath: string
  beforeRename?: () => void
  keepStart: number
  keepEnd: number
}): Promise<LoudnessMeasurement & LoudnessGain> {
  const tmpPath = `${destPath}.trim-${process.pid}-${Date.now()}.mp4`
  // 元の mp4 は取り込み時の範囲全体で -23 LUFS に揃えてあるので、切った区間だけを測って揃え直す。
  const measured = await measureLoudness({ ffmpeg, input: sourcePath, start: keepStart, end: keepEnd })
  const gain = loudnessGain(measured)
  try {
    await execFileAsync(ffmpeg, [
      '-y',
      '-i', sourcePath,
      '-ss', keepStart.toFixed(6),
      '-to', keepEnd.toFixed(6),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'veryfast',
      '-crf', '28',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-ar', '44100',
      '-ac', '2',
      '-af', [audioResample, volumeFilter(gain.gainDb)].filter(Boolean).join(','),
      '-movflags', '+faststart',
      tmpPath,
    ])
    beforeRename?.()
    fs.renameSync(tmpPath, destPath)
  } catch (error) {
    fs.rmSync(tmpPath, { force: true })
    throw error
  }
  return { ...measured, ...gain }
}

async function trimVideoFile(options: {
  ffmpeg: string
  audioResample: string
  sourcePath: string
  keepStart: number
  keepEnd: number
}): Promise<{ moved: string, loudness: LoudnessMeasurement & LoudnessGain }> {
  let moved = ''
  const loudness = await encodeRange({
    ...options,
    destPath: options.sourcePath,
    beforeRename: () => { moved = moveToTrash(options.sourcePath, 'videos') },
  })
  return { moved, loudness }
}

function cacheVideoPath(cacheRoot: string, videoId: unknown, fileBaseName: string): string | null {
  if (typeof videoId !== 'string' || !/^[\w-]+$/.test(videoId)) {
    return null
  }
  return path.join(cacheRoot, videoId, `${fileBaseName}.mp4`)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error) {
    const detail = String((error as Error & { stderr?: unknown }).stderr || '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop()
    if (detail) {
      return detail
    }
  }
  return error instanceof Error ? error.message : String(error)
}

async function handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!assertLocalRequest(req, res)) {
    return
  }

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
  if (!assertLocalRequest(req, res)) {
    return
  }

  try {
    const payload = JSON.parse(await readBody(req)) as SavePayload

    // 既存ファイルのみ編集可（新規作成はしない）。
    const filePath = resolveDataFile(payload.fileBaseName, res)
    if (!filePath) {
      return
    }

    let current = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>

    if (payload.camera !== undefined) {
      const patched = applyCameraPatch(current, payload.camera as { aspect: string; keyframes: unknown })
      if (patched.error !== undefined) {
        sendJson(res, 400, { error: patched.error })
        return
      }
      current = patched.data
    }

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

    // 「このままで良い」の記録。今の値と合わないもの・切り終えた trim は落とし、何も残らなければキーごと消す。
    const nextReview = normalizeReview(Object.hasOwn(payload, 'review') ? payload.review : current.review, current)
    if (nextReview) {
      current.review = nextReview
    } else {
      delete current.review
    }

    // extract.js と同じフォーマット（2スペースインデント）で書き戻し、差分を最小化する。
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2))
    sendJson(res, 200, current)
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

// dev サイトの「未DL」バッジ用。public/videos にある mp4 の一覧（拡張子なし）を返す。
// ダウンロード中の一時ファイル（<base>_temp.mp4）とトリムの一時ファイル（<base>.mp4.trim-*.mp4）は除く。
function handleStatus(req: IncomingMessage, res: ServerResponse): void {
  if (!assertLocalRequest(req, res)) {
    return
  }

  try {
    const videos = fs.existsSync(videosDir)
      ? fs.readdirSync(videosDir)
          .filter((name) => /^[\w.-]+\.mp4$/.test(name) && !name.endsWith('_temp.mp4') && !name.includes('.mp4.'))
          .map((name) => name.slice(0, -'.mp4'.length))
      : []
    res.setHeader('Cache-Control', 'no-store')
    sendJson(res, 200, { videos })
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function handleTrim(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!assertLocalRequest(req, res)) {
    return
  }

  try {
    const payload = JSON.parse(await readBody(req)) as TrimPayload
    const parsed = parseTrimPayload(payload)

    const filePath = resolveDataFile(parsed.fileBaseName, res)
    if (!filePath) {
      return
    }

    const videoPath = path.join(videosDir, `${parsed.fileBaseName}.mp4`)
    if (!fs.existsSync(videoPath)) {
      sendJson(res, 404, { error: 'video file not found' })
      return
    }

    const current = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
    const { ffmpegModule, assetsModule } = await loadFfmpegModules()
    const tools = ffmpegModule.resolveFfmpeg()
    const sourceDuration = ffmpegModule.probeDuration(tools.ffprobe, videoPath)
    const plan = createTrimPlan(parsed, current, sourceDuration)

    if (!plan.noop) {
      const trimmed = await trimVideoFile({
        ffmpeg: tools.ffmpeg,
        audioResample: ffmpegModule.AUDIO_RESAMPLE,
        sourcePath: videoPath,
        keepStart: plan.keepStart,
        keepEnd: plan.keepEnd,
      })
      const moved = [trimmed.moved]
      const hqCachePath = cacheVideoPath(assetsModule.cacheRoot, plan.updated.videoId, parsed.fileBaseName)
      if (hqCachePath && fs.existsSync(hqCachePath)) {
        moved.push(moveToTrash(hqCachePath, path.join('cache', String(plan.updated.videoId))))
      }

      fs.writeFileSync(filePath, JSON.stringify(plan.updated, null, 2))
      sendJson(res, 200, { updated: plan.updated, moved, loudness: trimmed.loudness })
      return
    }

    sendJson(res, 200, { updated: plan.updated, moved: [] })
  } catch (error) {
    if (error instanceof TrimValidationError) {
      sendJson(res, error.status, { error: error.message })
      return
    }
    sendJson(res, 500, { error: errorMessage(error) })
  }
}

// download.js の 1 区間モードで YouTube から取り直す。download.js は execFileSync で yt-dlp を待つので、
// dev サーバを止めないよう子プロセスで走らせる。失敗時は出力の末尾をエラーにする。
function downloadRange(options: { videoId: string, startTime: number, endTime: number, outPath: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      downloadScript,
      '--video-id', options.videoId,
      '--start', String(options.startTime),
      '--end', String(options.endTime),
      '--out', options.outPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const lines: string[] = []
    const keepTail = (chunk: Buffer) => {
      lines.push(...chunk.toString().split(/[\r\n]+/).filter(Boolean))
      lines.splice(0, Math.max(0, lines.length - 20))
    }
    child.stdout.on('data', keepTail)
    child.stderr.on('data', keepTail)
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      const detail = lines.filter((line) => /❌|ERROR|失敗/.test(line)).pop() ?? lines.pop()
      reject(new Error(detail ?? `download.js が終了コード ${code} で失敗しました`))
    })
  })
}

// 同じクリップへの並行リクエストは取り直し前に 409 にする。
const pendingExtends = new Set<string>()

async function handleExtend(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!assertLocalRequest(req, res)) {
    return
  }

  let reserved: string | undefined
  let tmpPath: string | undefined
  try {
    const parsed = parseExtendPayload(JSON.parse(await readBody(req)))
    const filePath = resolveDataFile(parsed.fileBaseName, res)
    if (!filePath) {
      return
    }
    if (pendingExtends.has(parsed.fileBaseName)) {
      throw new TrimValidationError(409, 'このクリップは取り直し中です')
    }
    reserved = parsed.fileBaseName
    pendingExtends.add(reserved)

    const readCurrent = () => JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
    const plan = createExtendPlan(parsed, readCurrent())
    fs.mkdirSync(extendTmpDir, { recursive: true })
    tmpPath = path.join(extendTmpDir, `${parsed.fileBaseName}-${process.pid}-${Date.now()}.mp4`)
    await downloadRange({
      videoId: plan.videoId,
      startTime: plan.updated.trimming.startTime,
      endTime: plan.updated.trimming.endTime,
      outPath: tmpPath,
    })

    // 取り直しの間に serif などが保存されていても消さないよう、JSON を読み直してから当てる。
    const latest = createExtendPlan(parsed, readCurrent())
    if (latest.updated.trimming.startTime !== plan.updated.trimming.startTime
      || latest.updated.trimming.endTime !== plan.updated.trimming.endTime) {
      throw new TrimValidationError(409, '取り直しの間に範囲が変わりました。もう一度押してください。')
    }

    const videoPath = path.join(videosDir, `${parsed.fileBaseName}.mp4`)
    const moved: string[] = []
    if (fs.existsSync(videoPath)) {
      moved.push(moveToTrash(videoPath, 'videos'))
    }
    fs.renameSync(tmpPath, videoPath)
    tmpPath = undefined
    const { assetsModule } = await loadFfmpegModules()
    const hqCachePath = cacheVideoPath(assetsModule.cacheRoot, latest.videoId, parsed.fileBaseName)
    if (hqCachePath && fs.existsSync(hqCachePath)) {
      moved.push(moveToTrash(hqCachePath, path.join('cache', latest.videoId)))
    }

    fs.writeFileSync(filePath, JSON.stringify(latest.updated, null, 2))
    sendJson(res, 200, { updated: latest.updated, moved, addedStart: latest.addedStart, addedEnd: latest.addedEnd })
  } catch (error) {
    if (error instanceof TrimValidationError) {
      sendJson(res, error.status, { error: error.message })
      return
    }
    sendJson(res, 500, { error: errorMessage(error) })
  } finally {
    if (tmpPath) {
      fs.rmSync(tmpPath, { force: true })
    }
    if (reserved) {
      pendingExtends.delete(reserved)
    }
  }
}

// 同じ出力への並行リクエストも、エンコード前に 409 にする。
const pendingExcerpts = new Set<string>()

async function handleExcerpt(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!assertLocalRequest(req, res)) {
    return
  }

  let reservedTarget: string | undefined
  try {
    const parsed = parseTrimPayload(JSON.parse(await readBody(req)))
    const filePath = resolveDataFile(parsed.fileBaseName, res)
    if (!filePath) {
      return
    }
    const videoPath = path.join(videosDir, `${parsed.fileBaseName}.mp4`)
    if (!fs.existsSync(videoPath)) {
      sendJson(res, 404, { error: 'video file not found' })
      return
    }

    const current = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
    const { ffmpegModule } = await loadFfmpegModules()
    const tools = ffmpegModule.resolveFfmpeg()
    const sourceDuration = ffmpegModule.probeDuration(tools.ffprobe, videoPath)
    const plan = createExcerptPlan(parsed, current, sourceDuration)
    const targetJson = path.join(dataDir, `${plan.targetBaseName}.json`)
    const targetVideo = path.join(videosDir, `${plan.targetBaseName}.mp4`)
    const assertTargetAbsent = () => {
      if (fs.existsSync(targetJson) || fs.existsSync(targetVideo)) {
        throw new TrimValidationError(409, `同じ区間のクリップが既にあります: ${plan.targetBaseName}`)
      }
    }
    assertTargetAbsent()
    if (pendingExcerpts.has(plan.targetBaseName)) {
      throw new TrimValidationError(409, `同じ区間のクリップが既にあります: ${plan.targetBaseName}`)
    }
    reservedTarget = plan.targetBaseName
    pendingExcerpts.add(reservedTarget)

    const loudness = await encodeRange({
      ffmpeg: tools.ffmpeg,
      audioResample: ffmpegModule.AUDIO_RESAMPLE,
      sourcePath: videoPath,
      destPath: targetVideo,
      keepStart: plan.keepStart,
      keepEnd: plan.keepEnd,
      beforeRename: assertTargetAbsent,
    })
    try {
      fs.writeFileSync(targetJson, JSON.stringify(plan.created, null, 2), { flag: 'wx' })
    } catch (error) {
      fs.rmSync(targetVideo, { force: true })
      throw error
    }
    sendJson(res, 200, { fileBaseName: plan.targetBaseName, created: plan.created, loudness })
  } catch (error) {
    if (error instanceof TrimValidationError) {
      sendJson(res, error.status, { error: error.message })
      return
    }
    sendJson(res, 500, { error: errorMessage(error) })
  } finally {
    if (reservedTarget) {
      pendingExcerpts.delete(reservedTarget)
    }
  }
}

async function handleTranscribe(req: IncomingMessage, res: ServerResponse, env: Record<string, string | undefined>, repoRoot: string): Promise<void> {
  if (!assertLocalRequest(req, res)) {
    return
  }
  try {
    const payload = JSON.parse(await readBody(req)) as DeletePayload | null
    const fileBaseName = payload?.fileBaseName
    if (!resolveDataFile(fileBaseName, res)) {
      return
    }
    const videoPath = path.join(videosDir, `${fileBaseName as string}.mp4`)
    if (!fs.existsSync(videoPath)) {
      sendJson(res, 404, { error: 'video file not found' })
      return
    }
    const config = resolveWhisperConfig(env, repoRoot)
    const { ffmpegModule } = await loadFfmpegModules()
    const { ffmpeg } = ffmpegModule.resolveFfmpeg()
    sendJson(res, 200, await transcribeFile({ ffmpeg, videoPath, config }))
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function handleRuby(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!assertLocalRequest(req, res)) {
    return
  }
  try {
    const payload = JSON.parse(await readBody(req)) as { text?: unknown } | null
    if (typeof payload?.text !== 'string' || payload.text.length > 2000) {
      sendJson(res, 400, { error: 'text は2000文字以内の文字列を指定してください。' })
      return
    }
    sendJson(res, 200, { ruby: await toRuby(payload.text) })
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

export function dataEditorPlugin(): Plugin {
  return {
    name: 'mone-data-editor',
    apply: 'serve',
    configureServer(server) {
      const env = { ...loadEnv(server.config.mode, server.config.envDir, 'WHISPER_'), ...process.env }
      server.middlewares.use('/__data/transcribe', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        void handleTranscribe(req, res, env, server.config.root)
      })
      server.middlewares.use('/__data/ruby', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        void handleRuby(req, res)
      })
      server.middlewares.use('/__data/status', (req, res, next) => {
        if (req.method !== 'GET') {
          next()
          return
        }
        handleStatus(req, res)
      })
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
      server.middlewares.use('/__data/excerpt', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        void handleExcerpt(req, res)
      })
      server.middlewares.use('/__data/trim', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        void handleTrim(req, res)
      })
      server.middlewares.use('/__data/extend', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        void handleExtend(req, res)
      })
    },
  }
}
