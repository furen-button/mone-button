import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  DOWNLOAD_ATTEMPTS,
  FFMPEG_INPUT_ARGS,
  buildYtDlpArgs,
  downloadClip,
  removeDownloadArtifacts,
} from './download.js';

describe('buildYtDlpArgs', () => {
  it('ffmpeg に再接続と読み取りタイムアウトを渡し、URL を最後に置く', () => {
    const args = buildYtDlpArgs({
      videoUrl: 'https://www.youtube.com/watch?v=abc',
      startTime: 10,
      endTime: 18,
      outputPath: '/tmp/clip_temp.mp4',
    });
    assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=abc');
    assert.equal(args[args.indexOf('-o') + 1], '/tmp/clip_temp.mp4');
    assert.equal(args[args.indexOf('--download-sections') + 1], '*10-18');
    assert.ok(args.includes('--force-keyframes-at-cuts'));
    assert.equal(args[args.indexOf('--downloader-args') + 1], `ffmpeg_i:${FFMPEG_INPUT_ARGS}`);
    assert.match(FFMPEG_INPUT_ARGS, /-reconnect 1 /u);
    assert.match(FFMPEG_INPUT_ARGS, /-reconnect_streamed 1 /u);
    assert.match(FFMPEG_INPUT_ARGS, /-rw_timeout 20000000$/u);
  });
});

describe('removeDownloadArtifacts', () => {
  it('途中ファイルを prefix ごと消し、完成ファイルは残す', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-artifacts-'));
    try {
      const temp = path.join(dir, 'clip_temp.mp4');
      for (const name of ['clip_temp.mp4', 'clip_temp.mp4.part', 'clip_temp.f394.mp4.part', 'clip.mp4', 'clip2_temp.mp4']) {
        fs.writeFileSync(path.join(dir, name), 'x');
      }
      removeDownloadArtifacts(temp);
      assert.deepEqual(fs.readdirSync(dir).sort(), ['clip.mp4', 'clip2_temp.mp4']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ディレクトリが無くても失敗しない', () => {
    assert.doesNotThrow(() => removeDownloadArtifacts(path.join(os.tmpdir(), 'no-such-dir-download-test', 'clip_temp.mp4')));
  });
});

// 実ネットワークを使わず、yt-dlp と ffprobe を偽物に差し替えて挙動を再現する。
// plan は試行ごとの振る舞い: { duration } は成功（映像尺）、{ exit } は異常終了、{ hang } は終わらない、{ broken } は壊れたファイル。
function withFakeTools(plan, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-test-'));
  const tempVideoPath = path.join(dir, 'clip_temp.mp4');
  const counter = path.join(dir, 'attempts');
  const planFile = path.join(dir, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const oldPath = process.env.PATH;
  const writeTool = (name, script) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${script}`);
    fs.chmodSync(file, 0o755);
    return file;
  };
  writeTool('yt-dlp', `
    const fs = require('node:fs');
    const plan = JSON.parse(fs.readFileSync(${JSON.stringify(planFile)}, 'utf8'));
    const counter = ${JSON.stringify(counter)};
    const attempt = fs.existsSync(counter) ? Number(fs.readFileSync(counter)) : 0;
    fs.writeFileSync(counter, String(attempt + 1));
    const out = process.argv[process.argv.indexOf('-o') + 1];
    if (fs.existsSync(out) || fs.existsSync(out + '.part') || fs.existsSync(out.replace(/\\.mp4$/, '.f394.mp4.part'))) {
      throw new Error('途中ファイルが残っています');
    }
    const step = plan[Math.min(attempt, plan.length - 1)];
    fs.writeFileSync(out + '.part', 'partial');
    fs.writeFileSync(out.replace(/\\.mp4$/, '.f394.mp4.part'), 'partial');
    if (step.hang) {
      setTimeout(() => {}, 30000);
    } else if (step.exit) {
      process.exit(step.exit);
    } else {
      fs.rmSync(out.replace(/\\.mp4$/, '.f394.mp4.part'));
      fs.rmSync(out + '.part');
      fs.writeFileSync(out, step.broken ? 'broken' : String(step.duration));
    }
  `);
  const ffprobe = writeTool('ffprobe', `
    const fs = require('node:fs');
    const duration = Number(fs.readFileSync(process.argv.at(-1), 'utf8'));
    if (!Number.isFinite(duration)) {
      console.error('moov atom not found');
      process.exit(1);
    }
    console.log(JSON.stringify({ streams: [{ codec_type: 'video', duration }, { codec_type: 'audio', duration: 8 }] }));
  `);
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  const attemptsMade = () => (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0);
  const leftovers = () => fs.readdirSync(dir).filter((name) => name.startsWith('clip_temp')).sort();
  try {
    run({ tempVideoPath, ffprobe, attemptsMade, leftovers });
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const clip = { videoUrl: 'https://www.youtube.com/watch?v=test', startTime: 10, endTime: 18 };

describe('downloadClip', () => {
  it('正常な DL は一度で終わる', () => {
    withFakeTools([{ duration: 8 }], ({ tempVideoPath, ffprobe, attemptsMade, leftovers }) => {
      downloadClip({ ...clip, tempVideoPath, ffprobe });
      assert.equal(attemptsMade(), 1);
      assert.deepEqual(leftovers(), ['clip_temp.mp4']);
    });
  });

  it('映像が短ければ途中ファイルを消して一度だけ再 DL する', () => {
    withFakeTools([{ duration: 2 }, { duration: 8 }], ({ tempVideoPath, ffprobe, attemptsMade }) => {
      downloadClip({ ...clip, tempVideoPath, ffprobe });
      assert.equal(attemptsMade(), 2);
      assert.equal(fs.readFileSync(tempVideoPath, 'utf8'), '8');
    });
  });

  it('再 DL も短ければ日本語エラーを投げ、途中ファイルを残さない', () => {
    withFakeTools([{ duration: 2 }, { duration: 3 }], ({ tempVideoPath, ffprobe, attemptsMade, leftovers }) => {
      assert.throws(
        () => downloadClip({ ...clip, tempVideoPath, ffprobe }),
        /ダウンロードに 2 回失敗しました: 映像が短すぎます（期待 8\.000s \/ 実尺 3\.000s）/u,
      );
      assert.equal(attemptsMade(), DOWNLOAD_ATTEMPTS);
      assert.deepEqual(leftovers(), []);
    });
  });

  it('yt-dlp が異常終了したら .part ごと消して再試行する', () => {
    withFakeTools([{ exit: 1 }, { duration: 8 }], ({ tempVideoPath, ffprobe, attemptsMade, leftovers }) => {
      downloadClip({ ...clip, tempVideoPath, ffprobe });
      assert.equal(attemptsMade(), 2);
      assert.deepEqual(leftovers(), ['clip_temp.mp4']);
    });
  });

  it('yt-dlp が終わらなければ timeoutMs で中断し、途中ファイルを消す', () => {
    withFakeTools([{ hang: true }], ({ tempVideoPath, ffprobe, attemptsMade, leftovers }) => {
      const started = Date.now();
      assert.throws(
        // 偽 yt-dlp（node）の起動に数百 ms かかるので、起動が済んでから切れる長さにする。
        () => downloadClip({ ...clip, tempVideoPath, ffprobe, attempts: 1, timeoutMs: 2000 }),
        /ダウンロードに 1 回失敗しました: yt-dlp が 2 秒以内に終わらなかったので中断しました/u,
      );
      assert.ok(Date.now() - started < 15_000, 'タイムアウトが効いていない');
      assert.equal(attemptsMade(), 1);
      assert.deepEqual(leftovers(), []);
    });
  });

  it('ffprobe が尺を読めないファイルは失敗として扱う', () => {
    withFakeTools([{ broken: true }], ({ tempVideoPath, ffprobe, leftovers }) => {
      assert.throws(
        () => downloadClip({ ...clip, tempVideoPath, ffprobe, attempts: 1 }),
        /映像・音声の尺を取得できません/u,
      );
      assert.deepEqual(leftovers(), []);
    });
  });

  it('ffprobe が無いときは尺検査をスキップする', () => {
    withFakeTools([{ duration: 2 }], ({ tempVideoPath, attemptsMade }) => {
      downloadClip({ ...clip, tempVideoPath, ffprobe: null });
      assert.equal(attemptsMade(), 1);
      assert.equal(fs.readFileSync(tempVideoPath, 'utf8'), '2');
    });
  });
});
