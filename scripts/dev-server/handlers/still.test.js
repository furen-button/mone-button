import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { stillFileStamp } from './still.js';

describe('stillFileStamp', () => {
  it('入力 JSON と両動画の変更を拾い、生成物に影響されない', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-still-stamp-'));
    const root = { dataDir: path.join(dir, 'data'), videosDir: path.join(dir, 'videos'), cacheRoot: path.join(dir, 'cache') };
    for (const folder of Object.values(root)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    try {
      fs.writeFileSync(path.join(root.dataDir, 'test.json'), JSON.stringify({ videoId: 'abc' }));
      const first = stillFileStamp(root);
      fs.writeFileSync(path.join(root.cacheRoot, 'still.json'), '{}');
      assert.deepEqual(stillFileStamp(root), first);
      fs.writeFileSync(path.join(root.videosDir, 'test.mp4'), 'mp4');
      assert.notDeepEqual(stillFileStamp(root), first);
      const second = stillFileStamp(root);
      fs.writeFileSync(path.join(root.dataDir, 'test.json'), JSON.stringify({ videoId: 'abc', effects: {} }));
      assert.notDeepEqual(stillFileStamp(root), second);
      // base を渡すとそのクリップだけを見て、他のクリップの変更には反応しない。
      const own = stillFileStamp(root, 'test');
      fs.writeFileSync(path.join(root.dataDir, 'other.json'), JSON.stringify({ videoId: 'def' }));
      assert.deepEqual(stillFileStamp(root, 'test'), own);
      assert.equal(own.length, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
