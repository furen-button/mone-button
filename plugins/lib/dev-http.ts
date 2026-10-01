import type { IncomingMessage, ServerResponse } from 'node:http';

import { checkLocalRequest } from '../../scripts/dev-server/lib/guards.js';

const DEFAULT_LIMIT_BYTES = 1024 * 1024;

export function readBody(req: IncomingMessage, limitBytes = DEFAULT_LIMIT_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    req.on('data', (chunk: Buffer) => {
      if (settled) {
        return;
      }
      totalBytes += chunk.length;
      if (totalBytes > limitBytes) {
        settled = true;
        const error = new Error('request body too large');
        Object.assign(error, { status: 413 });
        req.destroy(error);
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });

    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function sendError(res: ServerResponse, status: number, error: string, detail?: unknown): void {
  sendJson(res, status, detail === undefined ? { error } : { error, detail });
}

export function assertLocalRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const result = checkLocalRequest({
    method: req.method,
    remoteAddress: req.socket.remoteAddress,
    host: req.headers.host,
    origin: stringHeader(req.headers.origin),
    secFetchSite: stringHeader(req.headers['sec-fetch-site']),
    contentType: stringHeader(req.headers['content-type']),
  });

  if (!result.ok) {
    sendError(res, result.status, result.reason);
    return false;
  }
  return true;
}

export function statusFromError(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    if (Number.isInteger(status) && status >= 400 && status < 600) {
      return status;
    }
  }
  return null;
}

function stringHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
