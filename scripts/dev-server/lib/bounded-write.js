import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// 同じディレクトリの一時ファイルへ上限付きで書き、完了後だけ置き換える。
export async function writeBounded(req, file, limit) {
  if (!req.stream) {
    throw Object.assign(new Error('body stream is required'), { status: 400 });
  }
  if (Number(req.headers['content-length']) > limit) {
    throw Object.assign(new Error('upload too large'), { status: 413 });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.${crypto.randomBytes(8).toString('hex')}.part`;
  let size = 0;
  const counter = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      callback(size > limit ? Object.assign(new Error('upload too large'), { status: 413 }) : null, chunk);
    },
  });
  try {
    await pipeline(req.stream, counter, fs.createWriteStream(partial, { flags: 'wx' }), { signal: req.signal });
    if (!size) {
      throw Object.assign(new Error('empty body'), { status: 400 });
    }
    fs.renameSync(partial, file);
    return size;
  } finally {
    fs.rmSync(partial, { force: true });
  }
}
