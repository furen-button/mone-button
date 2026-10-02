import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TrimValidationError, createTrimPlan } from './trim.js';

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
