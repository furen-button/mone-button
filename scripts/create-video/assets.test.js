import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { DOWNLOAD_SHORT_TOLERANCE_MS, downloadHighQuality, isDownloadTooShort } from './assets.js';

describe('DL 尺の判定', () => {
  it('許容を超えて短い映像を検出する', () => {
    assert.equal(DOWNLOAD_SHORT_TOLERANCE_MS, 250);
    assert.equal(isDownloadTooShort(6.858, 1.917), true);
    assert.equal(isDownloadTooShort(8, 7.749), true);
  });

  it('許容内・境界・長い映像は再 DL しない', () => {
    for (const actual of [7.9, 7.75, 8, 8.586]) {
      assert.equal(isDownloadTooShort(8, actual), false);
    }
    assert.equal(isDownloadTooShort(6.858, 6.608), false);
  });

  it('尺を取得できない場合は判定しない', () => {
    assert.equal(isDownloadTooShort(8, undefined), false);
    assert.equal(isDownloadTooShort(NaN, 1), false);
    assert.equal(isDownloadTooShort(0, 0), false);
  });
});

// 実ネットワーク・キャッシュを使わず、成功終了する途中切れ DL を再現する。
function withDownloadTools(durations, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-video-download-'));
  const outputPath = path.join(dir, 'clip.mp4');
  const counter = path.join(dir, 'attempts');
  const oldPath = process.env.PATH;
  const writeTool = (name, script) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${script}`);
    fs.chmodSync(file, 0o755);
    return file;
  };
  writeTool('yt-dlp', `
    const fs = require('node:fs');
    const counter = ${JSON.stringify(counter)};
    const attempt = fs.existsSync(counter) ? Number(fs.readFileSync(counter)) : 0;
    const out = process.argv[process.argv.indexOf('-o') + 1];
    if (fs.existsSync(out) || fs.existsSync(out + '.part') || fs.existsSync(out.replace(/\\.mp4$/, '.f137.mp4.part'))) {
      throw new Error('途中ファイルが残っています');
    }
    fs.writeFileSync(counter, String(attempt + 1));
    fs.writeFileSync(out, String(${JSON.stringify(durations)}[attempt]));
    fs.writeFileSync(out + '.part', 'partial');
    fs.writeFileSync(out.replace(/\\.mp4$/, '.f137.mp4.part'), 'partial');
  `);
  const ffprobe = writeTool('ffprobe', `
    const fs = require('node:fs');
    const duration = Number(fs.readFileSync(process.argv.at(-1)));
    console.log(JSON.stringify({ streams: [{ codec_type: 'video', duration }, { codec_type: 'audio', duration: 8 }] }));
  `);
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  try {
    run({ outputPath, ffprobe, counter });
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const clip = { base: 'clip', videoId: 'test', startTime: 10, endTime: 18 };

describe('downloadHighQuality', () => {
  it('短い DL の途中ファイルを削除し、一度だけ再 DL する', () => {
    withDownloadTools([2, 8], ({ outputPath, ffprobe, counter }) => {
      downloadHighQuality(clip, outputPath, { tools: { ffprobe } });
      assert.equal(fs.readFileSync(counter, 'utf8'), '2');
      assert.equal(fs.readFileSync(outputPath, 'utf8'), '8');
    });
  });

  it('再 DL も短ければ日本語エラーを投げ、キャッシュと途中ファイルを残さない', () => {
    withDownloadTools([2, 3], ({ outputPath, ffprobe, counter }) => {
      assert.throws(() => downloadHighQuality(clip, outputPath, { tools: { ffprobe } }), /clip: 期待 8\.000s \/ 実尺 3\.000s/u);
      assert.equal(fs.readFileSync(counter, 'utf8'), '2');
      assert.equal(fs.existsSync(outputPath), false);
      assert.equal(fs.existsSync(`${outputPath}.part`), false);
      assert.equal(fs.existsSync(outputPath.replace(/\.mp4$/u, '.f137.mp4.part')), false);
    });
  });

  it('正常な DL は一度で終わる', () => {
    withDownloadTools([8], ({ outputPath, ffprobe, counter }) => {
      downloadHighQuality(clip, outputPath, { tools: { ffprobe } });
      assert.equal(fs.readFileSync(counter, 'utf8'), '1');
    });
  });

  it('ffprobe が無いときは尺検査をスキップする', () => {
    withDownloadTools([2], ({ outputPath, counter }) => {
      downloadHighQuality(clip, outputPath);
      assert.equal(fs.readFileSync(counter, 'utf8'), '1');
      assert.equal(fs.existsSync(outputPath), true);
    });
  });
});
