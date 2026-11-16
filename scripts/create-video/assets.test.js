import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  DOWNLOAD_SHORT_TOLERANCE_MS,
  FFMPEG_INPUT_ARGS,
  downloadHighQuality,
  isDownloadTooShort,
} from './assets.js';

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
    fs.writeFileSync(counter + '.args', JSON.stringify(process.argv.slice(2)));
    const value = String(${JSON.stringify(durations)}[attempt]);
    // 'fail' は googlevideo の HTTP 403 などで途中ファイルだけ残して異常終了する DL。
    if (value === 'fail') {
      fs.writeFileSync(out + '.part', 'partial');
      process.exit(1);
    }
    // 'hang' は googlevideo が無応答で ffmpeg が固まり、終わらない DL。
    if (value === 'hang') {
      fs.writeFileSync(out + '.part', 'partial');
      setTimeout(() => {}, 60000);
      return;
    }
    fs.writeFileSync(out, value);
    fs.writeFileSync(out + '.part', 'partial');
    fs.writeFileSync(out.replace(/\\.mp4$/, '.f137.mp4.part'), 'partial');
  `);
  const ffprobe = writeTool('ffprobe', `
    const fs = require('node:fs');
    const raw = fs.readFileSync(process.argv.at(-1), 'utf8');
    // 'novideo' は映像が 0 フレームで返り、映像ストリームが読めない DL。
    const streams = raw === 'novideo'
      ? [{ codec_type: 'audio', duration: 8 }]
      : [{ codec_type: 'video', duration: Number(raw) }, { codec_type: 'audio', duration: 8 }];
    console.log(JSON.stringify({ streams }));
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

  it('映像ストリームが読めない DL は途中ファイルを削除し、一度だけ再 DL する', () => {
    withDownloadTools(['novideo', 8], ({ outputPath, ffprobe, counter }) => {
      downloadHighQuality(clip, outputPath, { tools: { ffprobe } });
      assert.equal(fs.readFileSync(counter, 'utf8'), '2');
      assert.equal(fs.readFileSync(outputPath, 'utf8'), '8');
    });
  });

  it('再 DL も映像ストリームが読めなければ日本語エラーを投げ、キャッシュと途中ファイルを残さない', () => {
    withDownloadTools(['novideo', 'novideo'], ({ outputPath, ffprobe, counter }) => {
      assert.throws(() => downloadHighQuality(clip, outputPath, { tools: { ffprobe } }), /映像・音声の尺を取得できません（clip）/u);
      assert.equal(fs.readFileSync(counter, 'utf8'), '2');
      assert.equal(fs.existsSync(outputPath), false);
      assert.equal(fs.existsSync(`${outputPath}.part`), false);
      assert.equal(fs.existsSync(outputPath.replace(/\.mp4$/u, '.f137.mp4.part')), false);
    });
  });

  it('yt-dlp が異常終了したら途中ファイルを削除し、一度だけ再 DL する', () => {
    withDownloadTools(['fail', 8], ({ outputPath, ffprobe, counter }) => {
      downloadHighQuality(clip, outputPath, { tools: { ffprobe } });
      assert.equal(fs.readFileSync(counter, 'utf8'), '2');
      assert.equal(fs.readFileSync(outputPath, 'utf8'), '8');
    });
  });

  it('ffprobe が無くても yt-dlp の異常終了は一度だけ再 DL する', () => {
    withDownloadTools(['fail', 8], ({ outputPath, counter }) => {
      downloadHighQuality(clip, outputPath);
      assert.equal(fs.readFileSync(counter, 'utf8'), '2');
      assert.equal(fs.readFileSync(outputPath, 'utf8'), '8');
    });
  });

  it('再 DL も yt-dlp が異常終了したら終了コードを含む日本語エラーを投げ、途中ファイルを残さない', () => {
    withDownloadTools(['fail', 'fail'], ({ outputPath, ffprobe, counter }) => {
      assert.throws(() => downloadHighQuality(clip, outputPath, { tools: { ffprobe } }), /yt-dlp が異常終了しました（clip: 終了コード 1）/u);
      assert.equal(fs.readFileSync(counter, 'utf8'), '2');
      assert.equal(fs.existsSync(outputPath), false);
      assert.equal(fs.existsSync(`${outputPath}.part`), false);
    });
  });

  it('yt-dlp が上限時間で終わらなければ中断し、一度だけ再 DL する', () => {
    withDownloadTools(['hang', 8], ({ outputPath, ffprobe, counter }) => {
      // 中断した回の途中ファイルが残っていれば、偽の yt-dlp が 2 回目で失敗する。
      downloadHighQuality(clip, outputPath, { tools: { ffprobe }, timeoutMs: 1500 });
      assert.equal(fs.readFileSync(counter, 'utf8'), '2');
      assert.equal(fs.readFileSync(outputPath, 'utf8'), '8');
    });
  });

  it('再 DL も上限時間で終わらなければ中断した旨の日本語エラーを投げる', () => {
    withDownloadTools(['hang', 'hang'], ({ outputPath, ffprobe, counter }) => {
      assert.throws(
        () => downloadHighQuality(clip, outputPath, { tools: { ffprobe }, timeoutMs: 1500 }),
        /yt-dlp が異常終了しました（clip: 2 秒以内に終わらなかったので中断）/u,
      );
      assert.equal(fs.readFileSync(counter, 'utf8'), '2');
      assert.equal(fs.existsSync(`${outputPath}.part`), false);
    });
  });

  it('正常な DL は一度で終わり、ffmpeg に再接続と読み取りタイムアウトを渡す', () => {
    withDownloadTools([8], ({ outputPath, ffprobe, counter }) => {
      downloadHighQuality(clip, outputPath, { tools: { ffprobe } });
      assert.equal(fs.readFileSync(counter, 'utf8'), '1');
      const args = JSON.parse(fs.readFileSync(`${counter}.args`, 'utf8'));
      assert.equal(args[args.indexOf('--downloader-args') + 1], `ffmpeg_i:${FFMPEG_INPUT_ARGS}`);
      assert.match(FFMPEG_INPUT_ARGS, /-rw_timeout 20000000$/u);
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
