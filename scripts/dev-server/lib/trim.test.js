import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TrimValidationError, createExcerptPlan, createTrimPlan } from './trim.js';

function clip(overrides = {}) {
  return {
    videoId: 'abc_123',
    serif: 'テスト',
    ruby: 'てすと',
    categories: ['テスト'],
    clipUrl: 'https://youtube.com/watch?v=abc_123&t=100s',
    memo: '',
    trimming: {
      startTime: 100,
      endTime: 104,
      duration: 4,
    },
    videoFile: { metadata: { title: 'test' } },
    ...overrides,
  };
}

describe('createTrimPlan', () => {
  it('updates trimming and rewrites clipUrl while preserving the original range once', () => {
    const current = clip();
    const plan = createTrimPlan({
      fileBaseName: '2024-01-01-abc_123-000100-000104',
      keepStart: 0.25,
      keepEnd: 3.5,
    }, current, 4);

    assert.equal(plan.noop, false);
    assert.equal(plan.updated.trimming.startTime, 100.25);
    assert.equal(plan.updated.trimming.endTime, 103.5);
    assert.equal(plan.updated.trimming.duration, 3.25);
    assert.deepEqual(plan.updated.trimming.original, {
      startTime: 100,
      endTime: 104,
      duration: 4,
    });
    assert.equal(plan.updated.clipUrl, 'https://youtube.com/watch?v=abc_123&t=100s');
    assert.deepEqual(current.trimming, {
      startTime: 100,
      endTime: 104,
      duration: 4,
    });
  });

  it('keeps an existing original value on later trims', () => {
    const current = clip({
      clipUrl: 'https://youtube.com/watch?v=abc_123',
      trimming: {
        startTime: 100.25,
        endTime: 103.5,
        duration: 3.25,
        original: {
          startTime: 100,
          endTime: 104,
          duration: 4,
        },
      },
    });
    const plan = createTrimPlan({
      fileBaseName: '2024-01-01-abc_123-000100-000104',
      keepStart: 0.5,
      keepEnd: 3,
    }, current, 3.25);

    assert.deepEqual(plan.updated.trimming.original, {
      startTime: 100,
      endTime: 104,
      duration: 4,
    });
    assert.equal(plan.updated.trimming.startTime, 100.75);
    assert.equal(plan.updated.clipUrl, 'https://youtube.com/watch?v=abc_123&t=100s');
  });

  it('marks tiny edge changes as no-op', () => {
    const current = clip();
    const plan = createTrimPlan({
      fileBaseName: '2024-01-01-abc_123-000100-000104',
      keepStart: 0.009,
      keepEnd: 3.995,
    }, current, 4);

    assert.equal(plan.noop, true);
    assert.equal(plan.updated, current);
  });

  it('rejects invalid clip names', () => {
    assert.throws(
      () => createTrimPlan({
        fileBaseName: '../escape',
        keepStart: 0,
        keepEnd: 1,
      }, clip(), 4),
      (error) => error instanceof TrimValidationError
        && error.status === 400
        && /fileBaseName/u.test(error.message),
    );
  });

  it('rejects ranges outside the source duration', () => {
    assert.throws(
      () => createTrimPlan({
        fileBaseName: 'clip_01-a',
        keepStart: 0,
        keepEnd: 4.001,
      }, clip(), 4),
      /outside source duration/u,
    );
  });

  it('rejects too-short selections', () => {
    assert.throws(
      () => createTrimPlan({
        fileBaseName: 'clip_01-a',
        keepStart: 1,
        keepEnd: 1.29,
      }, clip(), 4),
      /at least 0\.3 seconds/u,
    );
  });
});


describe('createExcerptPlan', () => {
  const payload = {
    fileBaseName: '2024-06-22-abc-def_123-000100-000104',
    keepStart: 1.25,
    keepEnd: 3.9,
  };

  it('floors and pads absolute times, uses the filename date and accepts hyphens in videoId', () => {
    const current = clip({
      videoId: 'abc-def_123',
      videoFile: { metadata: { uploadDate: '20250102' } },
    });
    const plan = createExcerptPlan(payload, current, 4);
    assert.equal(plan.fileBaseName, payload.fileBaseName);
    assert.equal(plan.targetBaseName, '2024-06-22-abc-def_123-000101-000103');
    assert.equal(plan.keepStart, 1.25);
    assert.equal(plan.keepEnd, 3.9);
  });

  it('copies fields and updates the range and URL without mutating the source', () => {
    const current = clip({ memo: 'メモ', effects: { zoom: { at: 2 } } });
    const before = structuredClone(current);
    const { created } = createExcerptPlan(payload, current, 4);
    for (const field of ['serif', 'ruby', 'categories', 'memo', 'videoFile', 'effects']) {
      assert.deepEqual(created[field], current[field]);
    }
    assert.equal(created.clipUrl, 'https://youtube.com/watch?v=abc_123&t=101s');
    assert.deepEqual(created.trimming, {
      startTime: 101.25, endTime: 103.9, duration: 3.9 - 1.25,
      original: { startTime: 100, endTime: 104, duration: 4 },
    });
    assert.deepEqual(current, before);
  });

  it('preserves an existing original range and adds t= to URLs without it', () => {
    const original = { startTime: 99, endTime: 105, duration: 6 };
    const current = clip({
      clipUrl: 'https://youtube.com/watch?v=abc_123',
      trimming: { startTime: 100, endTime: 104, duration: 4, original },
    });
    const { created } = createExcerptPlan(payload, current, 4);
    assert.deepEqual(created.trimming.original, original);
    assert.equal(created.clipUrl, 'https://youtube.com/watch?v=abc_123&t=101s');
  });

  it('falls back to uploadDate when the source filename has no date', () => {
    const plan = createExcerptPlan({ ...payload, fileBaseName: 'legacy-clip' },
      clip({ videoFile: { metadata: { uploadDate: '20240622' } } }), 4);
    assert.equal(plan.targetBaseName, '2024-06-22-abc_123-000101-000103');
  });

  it('rejects missing or malformed dates and invalid videoIds', () => {
    for (const current of [clip(), clip({ videoFile: { metadata: { uploadDate: '2024-06-22' } } })]) {
      assert.throws(() => createExcerptPlan({ ...payload, fileBaseName: 'legacy' }, current, 4),
        (error) => error instanceof TrimValidationError && error.status === 400);
    }
    for (const videoId of ['../escape', '', null, 'abc.def']) {
      assert.throws(() => createExcerptPlan(payload, clip({ videoId }), 4),
        (error) => error instanceof TrimValidationError && error.status === 400);
    }
  });

  it('rejects invalid payloads, source durations and ranges with 400', () => {
    for (const invalid of [null, { ...payload, fileBaseName: '../escape' },
      { ...payload, keepStart: NaN }, { ...payload, keepEnd: Infinity },
      { ...payload, keepStart: -0.1 }, { ...payload, keepEnd: 4.001 },
      { ...payload, keepStart: 2, keepEnd: 2 },
      { ...payload, keepStart: 2, keepEnd: 1 },
      { ...payload, keepStart: 1, keepEnd: 1.29 }]) {
      assert.throws(() => createExcerptPlan(invalid, clip(), 4),
        (error) => error instanceof TrimValidationError && error.status === 400);
    }
    for (const duration of [0, -1, NaN, Infinity]) {
      assert.throws(() => createExcerptPlan(payload, clip(), duration),
        (error) => error instanceof TrimValidationError && error.status === 400);
    }
  });

  it('returns 409 when flooring makes the target name identical to the source', () => {
    for (const keepStart of [0, 0.009, 0.5]) {
      assert.throws(() => createExcerptPlan({
        fileBaseName: '2024-06-22-abc_123-000100-000104', keepStart, keepEnd: 4,
      }, clip(), 4), (error) => error instanceof TrimValidationError && error.status === 409);
    }
  });
});
