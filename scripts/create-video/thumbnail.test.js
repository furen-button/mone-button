import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject, applyTemplate, parseAssetRef } from './thumbnail.js';
import { thumbnailPathsFor } from './summary.js';
const project = (layers) => ({ version: 1, size: { width: 1280, height: 720 }, layers });
test('thumbnail: text gradient defaults and explicit values normalize', () => {
  const normalize = (gradient) => normalizeProject(project([{ id: 't', type: 'text', gradient }])).layers[0];
  assert.deepEqual(normalize({ type: 'linear' }).gradient, {
    type: 'linear', from: '#FFFFFF', to: '#FF4FA0', angle: 0, scope: 'line',
  });
  for (const scope of ['line', 'block']) {
    for (const angle of [-360, 90, 360]) {
      const gradient = { type: 'linear', from: '#abcdef80', to: '#123456', angle, scope };
      const layer = normalize(gradient);
      assert.deepEqual(layer.gradient, gradient);
      assert.equal(layer.color, '#FF4FA0');
    }
  }
  assert.equal(
    normalizeProject(project([{ id: 't', type: 'text', color: '#123456', gradient: { type: 'linear' } }]))
      .layers[0].gradient.to,
    '#123456',
  );
});
test('thumbnail: rejects invalid text gradients', () => {
  for (const gradient of [
    null, [], 'linear', 1, {}, { type: 'radial' },
    ...['red', '#FFF', '#GGGGGG', null, 123].flatMap((value) => [
      { type: 'linear', from: value }, { type: 'linear', to: value },
    ]),
    ...[-361, 361, NaN, Infinity, '90', null].map((angle) => ({ type: 'linear', angle })),
    ...['all', '', null, 1].map((scope) => ({ type: 'linear', scope })),
  ]) {
    assert.throws(() => normalizeProject(project([{ id: 't', type: 'text', gradient }])));
  }
});
test('thumbnail: templates retain text gradients when applying slots', () => {
  const gradient = { type: 'linear', from: '#FFFFFF', to: '#FF4FA0', angle: 45, scope: 'block' };
  const template = project([{ id: 't', type: 'text', slot: 'title', gradient }]);
  assert.deepEqual(normalizeProject(template, { template: true }).layers[0].gradient, gradient);
  const applied = applyTemplate(template, { title: '題' });
  assert.deepEqual(applied.layers[0].gradient, gradient);
  assert.equal(applied.layers[0].text, '題');
});
test('thumbnail: legacy text output is unchanged and undefined patch removes gradient', () => {
  const input = project([{ id: 't', type: 'text' }]);
  const expected = project([{
    id: 't', type: 'text', x: 640, y: 360, rotation: 0, opacity: 1, hidden: false, locked: false,
    text: 'タイトル', font: 'Dela Gothic One', weight: 400, size: 100, color: '#FF4FA0',
    emphasisColor: '#FFD800', outlines: [], lineHeight: 1.1, letterSpacing: 0, align: 'left',
  }]);
  assert.deepEqual(normalizeProject(input), expected);
  assert.deepEqual(normalizeProject(input, { template: true }), expected);
  const enabled = normalizeProject(project([{ ...input.layers[0], gradient: { type: 'linear' } }]));
  const disabled = normalizeProject(project([{ ...enabled.layers[0], gradient: undefined }]));
  assert.deepEqual(disabled, expected);
  assert.equal(Object.hasOwn(disabled.layers[0], 'gradient'), false);
  assert.equal(JSON.stringify(disabled).includes('gradient'), false);
});
test('thumbnail: validates bounds, types, ids and references', () => {
  for (const layer of [
    { id: 'x', type: 'text', size: NaN },
    { id: 'x', type: 'image', src: 'https://evil' },
    { id: 'x', type: 'rect', opacity: 2 },
    { id: 'x', type: 'text', hidden: 'yes' },
  ]) {
    assert.throws(() => normalizeProject(project([layer])));
  }
  assert.throws(() =>
    normalizeProject(
      project([
        { id: 'x', type: 'rect' },
        { id: 'x', type: 'rect' },
      ]),
    ),
  );
  assert.throws(() => normalizeProject(project(Array(81).fill({}))));
  assert.equal(parseAssetRef('face:../bad.png'), null);
});
test('thumbnail: template cannot point at temporary assets or contain slot src', () => {
  for (const src of ['frame:' + 'a'.repeat(40), 'image:' + 'a'.repeat(32)]) {
    assert.throws(() => normalizeProject(project([{ id: 'x', type: 'image', src }]), { template: true }));
  }
  assert.throws(() =>
    normalizeProject(project([{ id: 'x', type: 'image', slot: 'face', src: 'face:mone/a.png' }]), { template: true }),
  );
  assert.equal(
    normalizeProject(project([{ id: 'x', type: 'image', src: 'face:mone/a.png' }]), { template: true }).layers[0].src,
    'face:mone/a.png',
  );
});
test('thumbnail: apply slots without mutating template; sidecar names', () => {
  const template = project([
    { id: 't', type: 'text', slot: 'title' },
    { id: 'f', type: 'image', slot: 'frame' },
  ]);
  const result = applyTemplate(template, {
    title: '{やられ}集',
    frame: { src: 'frame:' + 'a'.repeat(40), recipe: { source: 'cache:abc', at: 3, upscale: 'none' } },
  });
  assert.equal(result.layers[0].text, '{やられ}集');
  assert.equal(result.layers[1].recipe.at, 3);
  assert.equal(template.layers[1].src, undefined);
  assert.deepEqual(thumbnailPathsFor('output/日本語.mp4'), {
    jpg: 'output/日本語.thumbnail.jpg',
    png: 'output/日本語.thumbnail.png',
    json: 'output/日本語.thumbnail.json',
  });
});

import fs from 'node:fs';
import path from 'node:path';
test('thumbnail: all shipped templates validate and apply every slot', () => {
  const dir = new URL('./thumbnail-templates/', import.meta.url);
  for (const name of fs.readdirSync(dir)) {
    const template = JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8'));
    assert.ok(normalizeProject(template, { template: true }).layers.length);
    const applied = applyTemplate(template, {
      title: '題',
      subtitle: '副題',
      face: 'face:mone/test.png',
      frame: 'frame:' + 'a'.repeat(40),
    });
    assert.ok(
      applied.layers.some((l) => l.slot === 'title' && l.text === '題'),
      path.basename(name),
    );
  }
});
