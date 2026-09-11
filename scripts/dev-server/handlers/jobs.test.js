import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { JobManager } from './jobs.js';

function tempContext() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-jobs-'));
  const outputDir = path.join(root, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  return { projectRoot: root, presetsDir: root, outputDir, cacheDir: path.join(root, 'cache'), schemaPath: path.join(root, 'schema.json') };
}

// 完了済みジョブは subscribe の中で同期的に再送されるので、unsubscribe の代入後に解決する。
function collectUntilDone(manager, jobId, since = 0) {
  return new Promise((resolve) => {
    const events = [];
    let unsubscribe = null;
    unsubscribe = manager.subscribe(jobId, (event, data, id) => {
      events.push({ event, data, id });
      if (event === 'done') {
        queueMicrotask(() => {
          unsubscribe?.();
          resolve(events);
        });
      }
    }, since);
  });
}

// 擬似の子プロセス: node -e で createVideo と同じ絵文字行を出す。
const FAKE_BUILD = [
  "console.log('🚀 videoId=\"x\" のクリップ 2 件をまとめ動画にします（source=existing）');",
  "console.log('🎬 [1/2] 描画中: a');",
  "console.error('frame=  10 fps=0.0');",
  "console.log('🎬 [2/2] 描画中: b');",
  "console.log('✅ 完成: ' + process.cwd() + '/output/fake.mp4');",
  "console.log('   concat: concat-vcopy');",
  "console.log('🧪 QC: error 0 / warn 1 / info 2');",
].join('\n');

describe('JobManager', () => {
  it('stdout の行を progress / stage / done に変換し、since で再送できる', async () => {
    const context = tempContext();
    const manager = new JobManager(context);
    const started = manager.start({ kind: 'build', name: 'config.json', argv: [FAKE_BUILD], logName: 'config', script: '-e' });
    assert.equal(started.state, 'running');

    const events = await collectUntilDone(manager, started.id);
    const kinds = events.map((entry) => entry.event);
    assert.ok(kinds.includes('started'));
    assert.deepEqual(events.filter((entry) => entry.event === 'progress').map((entry) => entry.data), [
      { i: 1, n: 2, base: 'a' },
      { i: 2, n: 2, base: 'b' },
    ]);
    const done = events.at(-1);
    assert.equal(done.event, 'done');
    assert.equal(done.data.state, 'done');
    assert.equal(done.data.exitCode, 0);
    assert.equal(done.data.outBase, 'fake');
    assert.equal(done.data.concat, 'concat-vcopy');
    assert.deepEqual(done.data.qc, { error: 0, warn: 1, info: 2 });
    assert.equal(done.data.sidecars.mp4, false);
    assert.ok(events.some((entry) => entry.event === 'log' && entry.data.stream === 'err'));
    assert.ok(fs.readFileSync(path.join(context.outputDir, 'logs/config.log'), 'utf8').includes('🎬 [2/2] 描画中: b'));
    assert.equal(manager.current, null);
    assert.equal(manager.last.id, started.id);

    // since 以降だけ再送される（完了済みジョブでも読める）
    const replay = await collectUntilDone(manager, started.id, events[3].id);
    assert.ok(replay.every((entry) => entry.id > events[3].id));
  });

  it('実行中は 409 相当で二重起動を拒み、cancel でグループごと止める', async () => {
    const context = tempContext();
    const manager = new JobManager(context);
    const started = manager.start({ kind: 'build', name: 'config.json', argv: ['setInterval(() => {}, 1000); console.log("🎬 [1/9] 描画中: a");'], logName: 'config', script: '-e' });
    assert.throws(() => manager.start({ kind: 'build', name: 'config.json', argv: ['1'], logName: 'x', script: '-e' }), (error) => error.status === 409 && error.jobId === started.id);

    const donePromise = collectUntilDone(manager, started.id);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(manager.cancel(started.id), 'cancelling');
    const events = await donePromise;
    assert.equal(events.at(-1).data.state, 'cancelled');
    assert.equal(manager.cancel(started.id), 'cancelled');
    assert.equal(manager.cancel('nope'), null);
  });
});
