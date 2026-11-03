import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createThumbnailRoutes, extractFrame } from './thumb.js';
import { matchRoute } from './index.js';
import { resolveOutputFile } from './files.js';
const project = { version: 1, size: { width: 1280, height: 720 }, layers: [] };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const context = { projectRoot: root, outputDir: path.join(root, 'output') };
  function write(file, value) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof value === 'object' ? JSON.stringify(value) : value);
  }
  write('output/0_reviewed/日本語.mp4', 'video');
  write('output/日本語.render.json', {
    select: { mode: 'category', categories: ['やられ'] },
    segments: [
      { kind: 'clip', base: 'clip-a', durationSec: 5, telops: [{ name: 'serif', text: 'セリフ' }] },
      { kind: 'clip', base: 'clip-a' },
      { kind: 'card', base: 'card' },
      { kind: 'clip', base: 'clip-b' },
    ],
  });
  write('public/data/clip-a.json', { videoId: 'abcdef123' });
  write('cache/createVideo/abcdef123/clip-a.mp4', 'high');
  const routes = createThumbnailRoutes(context);
  async function call(method, url, body, data, headers = {}) {
    const u = new URL(url, 'http://localhost');
    const { route, params } = matchRoute(routes, method, u.pathname);
    return route.handler(
      {
        query: u.searchParams,
        body,
        headers,
        stream: data ? Readable.from(data) : undefined,
        signal: new AbortController().signal,
      },
      params,
    );
  }
  return { root, context, call, write };
}
test('thumbnail API: reviewed output resolves split sidecars without probing and deduplicates clips', async (t) => {
  const { call, write } = fixture(t);
  const outputs = (await call('GET', '/thumbnail/outputs')).json;
  assert.equal(outputs[0].base, '日本語');
  assert.equal(outputs[0].reviewed, true);
  let ctx = (await call('GET', '/thumbnail/context?name=日本語')).json;
  assert.equal(ctx.title, '{やられ}集');
  assert.equal(ctx.clips.length, 2);
  assert.equal(ctx.clips[0].serif, 'セリフ');
  assert.equal(ctx.clips[0].source, 'cache:clip-a');
  assert.equal(ctx.clips[1].source, null);
  write('output/0_reviewed/日本語.meta.json', { titleCandidates: ['候補'] });
  ctx = (await call('GET', '/thumbnail/context?name=日本語')).json;
  assert.equal(ctx.title, '候補');
  write('output/日本語.render.json', { segments: [] });
  write('output/0_reviewed/日本語.meta.json', { chapters: [{ title: '✨見出し' }] });
  assert.equal((await call('GET', '/thumbnail/context?name=日本語')).json.title, '見出し');
});
test('thumbnail API: names, projects, images, templates and size limits', async (t) => {
  const { root, context, call, write } = fixture(t);
  assert.equal((await call('POST', '/thumbnail/project', { target: '日本語', project })).status, 200);
  assert.ok(fs.existsSync(path.join(root, 'output/0_reviewed/日本語.thumbnail.json')));
  assert.equal((await call('GET', '/thumbnail/context?name=日本語')).json.project.version, 1);
  assert.equal((await call('POST', '/thumbnail/project', { target: 'name:もね・！？', project })).status, 200);
  assert.equal((await call('POST', '/thumbnail/project', { target: '../x', project })).status, 404);
  const jpgHeaders = { 'content-type': 'image/jpeg' };
  assert.equal(
    (await call('POST', '/thumbnail/save?target=日本語&format=jpg', undefined, [Buffer.from('jpeg')], jpgHeaders))
      .status,
    200,
  );
  assert.ok(resolveOutputFile(context, 'thumbnail-out', '日本語'));
  assert.equal(
    (
      await call(
        'POST',
        '/thumbnail/save?target=日本語&format=jpg',
        undefined,
        [Buffer.alloc(2 * 1024 ** 2 + 1)],
        jpgHeaders,
      )
    ).status,
    413,
  );
  assert.equal(fs.readFileSync(path.join(root, 'output/0_reviewed/日本語.thumbnail.jpg'), 'utf8'), 'jpeg');
  assert.equal(
    (
      await call('POST', '/thumbnail/image', undefined, [Buffer.alloc(20 * 1024 ** 2 + 1)], {
        'content-type': 'image/png',
      })
    ).status,
    413,
  );
  for (const name of ['../evil', 'A', 'a'.repeat(42)]) {
    assert.equal((await call('POST', '/thumbnail/template', { name, template: project })).status, 400);
  }
  assert.equal((await call('POST', '/thumbnail/template', { name: 'custom', template: project })).status, 200);
  assert.equal((await call('GET', '/thumbnail/templates')).json[0].name, 'custom');
  write('output/thumbnail-assets/' + 'a'.repeat(32) + '.png', 'png');
  const assets = (await call('GET', '/thumbnail/assets')).json;
  assert.equal(assets.images.length, 1);
  assert.equal(assets.faces.length, 0);
  assert.ok(resolveOutputFile(context, 'thumbnail-asset', assets.images[0].src));
  assert.equal(resolveOutputFile(context, 'thumbnail-asset', 'face:../evil.png'), null);
  fs.rmSync(path.join(root, 'output/thumbnails'), { recursive: true });
  fs.symlinkSync(os.tmpdir(), path.join(root, 'output/thumbnails'), 'dir');
  assert.equal((await call('POST', '/thumbnail/project', { target: 'name:unsafe', project })).status, 400);
});
test('thumbnail frame: seek precedes input, RGB fallback and stamp invalidation', async (t) => {
  const { context, write } = fixture(t);
  const args = [];
  const deps = {
    tools: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
    probe: () => ({ width: 1920, height: 1080, duration: 6 }),
    enhance: async () => ({ applied: false, reason: 'Vulkan unavailable' }),
    exec: async (_, argv) => {
      args.push(argv);
      fs.writeFileSync(argv.at(-1), 'png');
    },
  };
  const body = { source: 'cache:clip-a', at: 2, upscale: 'anime4k' };
  const a = await extractFrame(context, body, undefined, deps);
  assert.equal(a.width, 2560);
  assert.equal(a.height, 1440);
  assert.equal(a.fallback, true);
  assert.ok(args[0].indexOf('-ss') < args[0].indexOf('-i'));
  assert.match(args[0][args[0].indexOf('-vf') + 1], /lanczos.*format=rgb24/u);
  assert.equal((await extractFrame(context, body, undefined, deps)).cached, true);
  write('cache/createVideo/abcdef123/clip-a.mp4', 'changed-size');
  assert.notEqual((await extractFrame(context, body, undefined, deps)).src, a.src);
});

test('thumbnail assets: only cutouts, ratings matched by filename, preview cache reused', async (t) => {
  const { root, context, write } = fixture(t);
  write('public/face-focus/mone/crop/a.png', 'png');
  write('public/face-focus/mone/crop/b.png', 'png');
  write('public/face-focus/mone/frames/c.png', 'png');
  write('public/face-focus/index.json', {
    items: [
      { video: 'mone', kind: 'crop', path: 'dist/mone/crop/a.png', rating: 3 },
      { video: 'mone', kind: 'crop', path: 'dist/mone/crop/b.png', rating: 5 },
    ],
  });
  let calls = 0;
  const routes = createThumbnailRoutes(context, {
    tools: { ffmpeg: 'fake' },
    exec: async (_, argv) => {
      calls++;
      fs.writeFileSync(argv.at(-1), 'preview');
    },
  });
  const route = routes.find((r) => r.pattern.test('/thumbnail/assets'));
  const result = await route.handler({}, {});
  assert.deepEqual(
    result.json.faces.map((f) => f.rating),
    [5, 3],
  );
  assert.equal(calls, 2);
  assert.ok(resolveOutputFile(context, 'thumbnail-asset', result.json.faces[0].preview));
  await route.handler({}, {});
  assert.equal(calls, 2);
  assert.ok(fs.existsSync(path.join(root, 'cache/thumbnail/previews')));
});
test('thumbnail frame: Anime4K uses RGB filters and retries failed GPU rendering with Lanczos', async (t) => {
  const { context } = fixture(t);
  const args = [];
  const deps = {
    tools: { ffmpeg: 'fake', ffprobe: 'fake' },
    probe: () => ({ width: 1920, height: 1080, duration: 6 }),
    enhance: async () => ({ applied: true, restorePreset: '/tmp/restore.glsl', upscalePreset: '/tmp/upscale.glsl' }),
    exec: async (_, argv) => {
      args.push(argv);
      if (args.length === 1) {
        throw new Error('GPU failed');
      }
      fs.writeFileSync(argv.at(-1), 'png');
    },
  };
  const result = await extractFrame(context, { source: 'cache:clip-a', at: 1, upscale: 'anime4k' }, undefined, deps);
  assert.equal(result.applied, false);
  assert.equal(result.fallback, true);
  assert.match(args[0][args[0].indexOf('-vf') + 1], /restore.*format=rgb24.*upscale.*format=rgb24/u);
  assert.doesNotMatch(args[0].join(' '), /yuv420p/u);
  assert.match(args[1][args[1].indexOf('-vf') + 1], /lanczos/u);
});
