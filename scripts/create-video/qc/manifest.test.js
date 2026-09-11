import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { makeTextElement } from '../ass.js';
import { DEFAULTS, deepMerge, projectRoot } from '../config.js';
import { buildRenderManifest, manifestPathFor, readManifestFor, writeRenderManifest } from './manifest.js';

const SAMPLE_VIDEO_BYTES = 'これは manifest テスト用の mp4 代替ファイルです。\n';

function config() {
  return deepMerge(DEFAULTS, {
    select: { mode: 'videoId', videoId: 'abc123' },
    __meta: { configPath: path.join(projectRoot, 'scripts/create-video/config.json') },
  });
}

describe('render manifest', () => {
  it('生成情報、mp4 識別情報、テロップ矩形をプロジェクト相対パスで組み立てる', async () => {
    const dir = fs.mkdtempSync(path.join(projectRoot, 'tmp/qc-manifest-'));
    const videoOutPath = path.join(dir, 'test-combined.mp4');
    fs.writeFileSync(videoOutPath, SAMPLE_VIDEO_BYTES);
    const sourcePath = path.join(projectRoot, 'public/videos/clip-a.mp4');
    const element = makeTextElement({
      name: 'serif',
      text: 'こんにちは',
      style: config().telops.serif,
      width: 1280,
      height: 720,
      duration: 2,
    });
    const manifest = await buildRenderManifest({
      videoOutPath,
      config: config(),
      clips: [{ base: 'clip-a' }],
      renderedSegments: [{
        path: '/tmp/clip-a.mp4',
        kind: 'clip',
        clip: { base: 'clip-a', videoId: 'abc123' },
        sourcePath,
        elements: [element],
        atSec: 1.23456,
        durationSec: 2.34567,
      }],
      concatMethod: 'concat-vcopy',
      totalSec: 3.58023,
      size: { width: 1280, height: 720, fps: 30 },
    });

    assert.equal(manifest.version, 2);
    assert.equal(manifest.video, path.relative(projectRoot, videoOutPath));
    assert.equal(manifest.videoBytes, Buffer.byteLength(SAMPLE_VIDEO_BYTES));
    assert.match(manifest.videoSha256, /^[0-9a-f]{64}$/u);
    assert.equal(manifest.configPath, 'scripts/create-video/config.json');
    assert.equal(manifest.select.videoId, 'abc123');
    assert.equal(manifest.totalSec, 3.58);
    assert.equal(manifest.segments[0].sourcePath, 'public/videos/clip-a.mp4');
    assert.deepEqual(Object.keys(manifest.segments[0].telops[0].rect), ['x', 'y', 'w', 'h']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('補正（enhance）の判断をセグメントに残す', async () => {
    const dir = fs.mkdtempSync(path.join(projectRoot, 'tmp/qc-manifest-'));
    const videoOutPath = path.join(dir, 'enhance.mp4');
    fs.writeFileSync(videoOutPath, SAMPLE_VIDEO_BYTES);
    const segment = (enhance) => ({
      path: '/tmp/clip.mp4',
      kind: 'clip',
      clip: { base: 'clip-a', videoId: 'abc123' },
      sourcePath: path.join(projectRoot, 'cache/createVideo/abc123/clip-a.mp4'),
      elements: [],
      atSec: 0,
      durationSec: 2,
      enhance,
    });
    const manifest = await buildRenderManifest({
      videoOutPath,
      config: config(),
      clips: [{ base: 'clip-a' }, { base: 'clip-b' }, { base: 'clip-c' }],
      renderedSegments: [
        segment({
          applied: true,
          backend: 'anime4k',
          restore: 'Restore_CNN_M',
          upscale: null,
          restorePreset: '/x/.presets/Clamp_Highlights+Restore_CNN_M.glsl',
          from: { w: 1920, h: 1080 },
        }),
        segment({ applied: false, fallback: true, reason: 'libplacebo が使えません' }),
        segment(null),
      ],
      concatMethod: 'concat-vcopy',
      totalSec: 6,
      size: { width: 1920, height: 1080, fps: 30 },
    });
    assert.deepEqual(manifest.segments[0].enhance, {
      applied: true,
      backend: 'anime4k',
      restore: 'Restore_CNN_M',
      upscale: null,
      from: { w: 1920, h: 1080 },
    });
    assert.deepEqual(manifest.segments[1].enhance, { applied: false, fallback: true, reason: 'libplacebo が使えません' });
    assert.equal('enhance' in manifest.segments[2], false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('write/read で同じ manifest を読める', async () => {
    const dir = fs.mkdtempSync(path.join(projectRoot, 'tmp/qc-manifest-'));
    const videoOutPath = path.join(dir, 'sample.mp4');
    fs.writeFileSync(videoOutPath, SAMPLE_VIDEO_BYTES);
    const { path: outPath, manifest } = await writeRenderManifest({
      videoOutPath,
      config: config(),
      clips: [],
      renderedSegments: [],
      concatMethod: 'concat-vcopy',
      totalSec: 0,
      size: { width: 1280, height: 720, fps: 30 },
    });
    assert.equal(outPath, manifestPathFor(videoOutPath));
    const read = await readManifestFor(videoOutPath);
    assert.equal(read.missing, false);
    assert.deepEqual(read.results, []);
    assert.deepEqual(read.manifest, manifest);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('manifest 欠損時は missing=true で返す', async () => {
    const read = await readManifestFor('/tmp/no-such-video.mp4');
    assert.equal(read.manifest, null);
    assert.equal(read.missing, true);
  });

  it('version 1 manifest は陳腐化確認不可を info で返す', async () => {
    const dir = fs.mkdtempSync(path.join(projectRoot, 'tmp/qc-manifest-'));
    const videoOutPath = path.join(dir, 'sample.mp4');
    const manifestPath = manifestPathFor(videoOutPath);
    fs.writeFileSync(videoOutPath, SAMPLE_VIDEO_BYTES);
    fs.writeFileSync(manifestPath, `${JSON.stringify({ version: 1, video: 'sample.mp4' }, null, 2)}\n`);

    const read = await readManifestFor(videoOutPath);
    assert.equal(read.missing, false);
    assert.equal(read.results[0].level, 'info');
    assert.equal(read.results[0].code, 'manifest_stale_unverifiable');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('mp4 と manifest の識別情報が違えば manifest_stale error にする', async () => {
    const dir = fs.mkdtempSync(path.join(projectRoot, 'tmp/qc-manifest-'));
    const videoOutPath = path.join(dir, 'sample.mp4');
    fs.writeFileSync(videoOutPath, SAMPLE_VIDEO_BYTES);
    await writeRenderManifest({
      videoOutPath,
      config: config(),
      clips: [],
      renderedSegments: [],
      concatMethod: 'concat-vcopy',
      totalSec: 0,
      size: { width: 1280, height: 720, fps: 30 },
    });

    fs.writeFileSync(videoOutPath, '別の動画ファイルに差し替えた想定です。\n');
    const read = await readManifestFor(videoOutPath);
    assert.equal(read.results[0].level, 'error');
    assert.equal(read.results[0].code, 'manifest_stale');
    assert.match(read.results[0].message, /createVideo をやり直してください/u);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('--allow-stale-manifest 相当では不一致を info に落として続行する', async () => {
    const dir = fs.mkdtempSync(path.join(projectRoot, 'tmp/qc-manifest-'));
    const videoOutPath = path.join(dir, 'sample.mp4');
    fs.writeFileSync(videoOutPath, SAMPLE_VIDEO_BYTES);
    await writeRenderManifest({
      videoOutPath,
      config: config(),
      clips: [],
      renderedSegments: [],
      concatMethod: 'concat-vcopy',
      totalSec: 0,
      size: { width: 1280, height: 720, fps: 30 },
    });

    fs.writeFileSync(videoOutPath, '別の動画ファイルに差し替えた想定です。\n');
    const read = await readManifestFor(videoOutPath, null, { allowStaleManifest: true });
    assert.equal(read.results[0].level, 'info');
    assert.equal(read.results[0].code, 'manifest_stale_allowed');
    assert.match(read.results[0].message, /検証用/u);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
