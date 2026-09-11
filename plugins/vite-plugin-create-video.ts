import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { assertLocalRequest, readBody, sendError, sendJson, statusFromError } from './lib/dev-http'
import type { HandlerRequest, HandlerResult, Route } from '../scripts/dev-server/handlers'

type HandlerModule = {
  createHandlers: () => Route[]
  matchRoute: (routes: Route[], method: string, path: string) => { route: Route; params: Record<string, string> } | null
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
let handlerModulePromise: Promise<HandlerModule> | null = null
let routes: Route[] | null = null

export function createVideoEditorPlugin(): Plugin {
  return {
    name: 'mone-create-video-editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__cv', (req, res) => {
        void handleRequest(req, res)
      })
    },
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!assertLocalRequest(req, res)) {
    return
  }

  const method = req.method || 'GET'
  const { path: requestPath, query } = parseRequestUrl(req.url || '/')
  let abort: (() => void) | null = null

  try {
    const handlers = await loadHandlers()
    const matched = handlers.matchRoute(routesFor(handlers), method, requestPath)
    if (!matched) {
      sendError(res, 404, 'not found')
      return
    }

    const controller = new AbortController()
    abort = () => controller.abort()
    req.socket.once('close', abort)

    const body = method === 'POST' ? await parseJsonBody(req) : undefined
    const result = await matched.route.handler({
      method,
      path: requestPath,
      query,
      body,
      headers: req.headers,
      signal: controller.signal,
    } satisfies HandlerRequest, matched.params)

    req.socket.off('close', abort)
    abort = null
    sendHandlerResult(req, res, result)
  } catch (error) {
    if (abort) {
      req.socket.off('close', abort)
    }
    if (!res.headersSent) {
      const status = statusFromError(error) ?? 500
      sendError(res, status, error instanceof Error ? error.message : String(error))
    } else {
      res.destroy(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  let text: string
  try {
    text = await readBody(req)
  } catch (error) {
    const status = statusFromError(error)
    if (status === 413) {
      throw Object.assign(new Error('request body too large'), { status })
    }
    throw error
  }

  try {
    return JSON.parse(text)
  } catch {
    throw Object.assign(new Error('invalid json'), { status: 400 })
  }
}

function sendHandlerResult(req: IncomingMessage, res: ServerResponse, result: HandlerResult): void {
  if ('json' in result) {
    for (const [key, value] of Object.entries(result.headers || {})) {
      res.setHeader(key, value)
    }
    sendJson(res, result.status, result.json)
    return
  }

  if ('stream' in result) {
    res.statusCode = result.status
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value)
    }
    if (result.length !== undefined) {
      res.setHeader('Content-Length', String(result.length))
    }
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    result.stream.pipe(res)
    return
  }

  sendSse(req, res, result)
}

function sendSse(req: IncomingMessage, res: ServerResponse, result: Extract<HandlerResult, { sse: unknown }>): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const emit = (event: string, data: unknown, id?: number) => {
    if (id !== undefined) {
      res.write(`id: ${id}\n`)
    }
    res.write(`event: ${event}\n`)
    for (const line of JSON.stringify(data).split(/\r?\n/u)) {
      res.write(`data: ${line}\n`)
    }
    res.write('\n')
  }

  const since = Number(req.headers['last-event-id'] || 0)
  const unsubscribe = result.sse.subscribe(emit, Number.isFinite(since) ? since : 0)
  const ping = setInterval(() => {
    res.write(': ping\n\n')
  }, 15000)

  req.on('close', () => {
    clearInterval(ping)
    unsubscribe()
  })
}

async function loadHandlers(): Promise<HandlerModule> {
  if (!handlerModulePromise) {
    const handlerPath = path.resolve(currentDir, '../scripts/dev-server/handlers/index.js')
    handlerModulePromise = import(/* @vite-ignore */ pathToFileURL(handlerPath).href) as Promise<HandlerModule>
  }
  return handlerModulePromise
}

function routesFor(handlers: HandlerModule): Route[] {
  if (!routes) {
    routes = handlers.createHandlers()
  }
  return routes
}

function parseRequestUrl(url: string): { path: string; query: URLSearchParams } {
  const parsed = new URL(url, 'http://localhost')
  const pathname = parsed.pathname.startsWith('/__cv/') ? parsed.pathname.slice('/__cv'.length) : parsed.pathname
  return { path: pathname === '' ? '/' : pathname, query: parsed.searchParams }
}
