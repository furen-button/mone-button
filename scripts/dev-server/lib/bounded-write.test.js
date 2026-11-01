import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { writeBounded } from './bounded-write.js';
test('bounded write: preserves old file on excess bytes, disconnect and abort, removes partial files', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'saved.jpg');
  fs.writeFileSync(file, 'old');
  const broken = Readable.from(
    (async function* () {
      yield Buffer.from('x');
      throw new Error('disconnected');
    })(),
  );
  for (const stream of [Readable.from([Buffer.alloc(5), Buffer.alloc(6)]), broken]) {
    await assert.rejects(writeBounded({ stream, headers: {} }, file, 10));
    assert.equal(fs.readFileSync(file, 'utf8'), 'old');
    assert.deepEqual(fs.readdirSync(dir), ['saved.jpg']);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    writeBounded({ stream: Readable.from(['new']), headers: {}, signal: controller.signal }, file, 10),
  );
  assert.deepEqual(fs.readdirSync(dir), ['saved.jpg']);
  assert.equal(await writeBounded({ stream: Readable.from(['new']), headers: {} }, file, 10), 3);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
});
