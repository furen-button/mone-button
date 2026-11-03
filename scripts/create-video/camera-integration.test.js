import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { sourceCompareFilters, reframeCompareCrop } from './qc/checks/sync.js';
import { checkReframe } from './qc/checks/probe.js';
import { buildRenderManifest } from './qc/manifest.js';
import { DEFAULTS } from './config.js';

it('QC は offset の構図を静的に再現し、camera と fallback を manifest に残す', async () => {
  const camera = { applied: true, aspect: '1:1', from: { width: 1920, height: 1080 }, backend: 'sendcmd', fallback: true,
    keyframes: [{ t: 0, x: 0.5, y: 0.5, zoom: 1, ease: 'cut' }, { t: 1, x: 0.7, y: 0.5, zoom: 2 }] };
  const segment = { kind: 'clip', camera, elements: [], path: 'test.mp4', serifRange: { bottom: 240 } };
  const size = { width: 1080, height: 1080, fps: 30 };
  const crop = reframeCompareCrop(size, segment);
  assert.match(crop, /^crop=/u);
  assert.notEqual(sourceCompareFilters(segment, size, crop, 0), sourceCompareFilters(segment, size, crop, 1));
  assert.doesNotMatch(sourceCompareFilters(segment, size, crop, 1), /libplacebo|\bt\b/u);
  assert.equal(checkReframe({ manifest: { segments: [segment] } })[0].code, 'camera_fallback');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-manifest-'));
  try {
    const videoOutPath = path.join(dir, 'test.mp4');
    fs.writeFileSync(videoOutPath, 'mp4');
    const manifest = await buildRenderManifest({ videoOutPath, config: DEFAULTS, clips: [], renderedSegments: [segment], size, totalSec: 2, concatMethod: 'concat-vcopy' });
    assert.deepEqual(manifest.segments[0].camera, camera);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
