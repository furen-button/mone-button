import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clipFfmpegArgs } from './clip.js';
import { DEFAULTS, deepMerge } from './config.js';
import { AUDIO_RESAMPLE } from './ffmpeg.js';
import { afterTransitionIn } from './qc/checks/sync.js';
import {
  planClipTransition,
  planTransitions,
  transitionAudioGraph,
  transitionHalf,
  whipFilterChain,
} from './transition.js';

const size = { width: 1920, height: 1080, fps: 30 };
const clips = ['a', 'a', 'b', 'c', 'c'].map((videoId, i) => ({ videoId, base: `${videoId}-${i}` }));

function configWith(transitions, extra = {}) {
  return deepMerge(DEFAULTS, { cards: { enabled: false }, transitions, ...extra });
}

describe('planTransitions', () => {
  it('stream は videoId が変わる繋ぎ目だけに出と入りを付ける', () => {
    const plans = planTransitions(clips, configWith({ mode: 'stream' }));
    assert.deepEqual(plans, [
      { in: false, out: false },
      { in: false, out: true },
      { in: true, out: true },
      { in: true, out: false },
      { in: false, out: false },
    ]);
  });

  it('all はすべての繋ぎ目、none と区切りカードありは何も付けない', () => {
    const all = planTransitions(clips, configWith({ mode: 'all' }));
    assert.deepEqual(all.map((plan) => [plan.in, plan.out]), [[false, true], [true, true], [true, true], [true, true], [true, false]]);
    assert.ok(planTransitions(clips, configWith({ mode: 'none' })).every((plan) => !plan.in && !plan.out));
    const withCards = planTransitions(clips, configWith({ mode: 'stream' }, { cards: { enabled: true } }));
    assert.ok(withCards.every((plan) => !plan.in && !plan.out));
  });
});

describe('planClipTransition', () => {
  const config = configWith({ mode: 'stream', duration: 0.5, se: { enabled: false } });

  it('入りは先頭、出は末尾に half 秒ずつ窓を置く', () => {
    const plan = planClipTransition({ side: { in: true, out: true }, config, duration: 3, size });
    assert.deepEqual(plan.in, { start: 0, end: 0.25 });
    assert.deepEqual(plan.out, { start: 2.75, end: 3 });
    assert.equal(plan.shift, 1920);
  });

  it('短いクリップでは片側をクリップ尺の 1/3 までに縮める', () => {
    assert.equal(transitionHalf(config, 0.6), 0.2);
    assert.equal(planClipTransition({ side: { in: false, out: false }, config, duration: 3, size }), null);
  });
});

describe('whipFilterChain', () => {
  const config = configWith({ mode: 'stream', se: { enabled: false } });

  it('出る側は窓の開始から有効で、最後のブラーは開いた窓にする', () => {
    const plan = planClipTransition({ side: { out: true }, config, duration: 2, size });
    const chain = whipFilterChain(plan, 1920);
    assert.match(chain, /^split=3\[two0\]\[two1\]\[two2\];\[two0\]\[two1\]overlay=x='-\(mod\(1920\*pow\(clip\(\(t-1\.75\)\/0\.25,0,1\),2\),1920\)\)'/);
    assert.match(chain, /enable='gte\(t,1\.75\)'/);
    const blurs = chain.match(/gblur=sigma=[\d.]+:sigmaV=0:enable='[^']*'/g);
    assert.ok(blurs.length >= 6);
    assert.ok(blurs.every((stage) => stage.includes('sigmaV=0')));
    assert.match(blurs.at(-1), /enable='gte\(t,/);
  });

  it('入る側は先頭のブラーを開いた窓にし、sigma が減っていく', () => {
    const plan = planClipTransition({ side: { in: true }, config, duration: 2, size });
    const blurs = whipFilterChain(plan, 1920).match(/gblur=sigma=[\d.]+:sigmaV=0:enable='[^']*'/g);
    assert.match(blurs[0], /enable='lt\(t,/);
    const sigmas = blurs.map((stage) => Number(stage.match(/sigma=([\d.]+)/)[1]));
    assert.deepEqual([...sigmas].sort((a, b) => b - a), sigmas);
  });
});

describe('トランジションの音声', () => {
  it('クリップ音声は AUDIO_RESAMPLE を通してから SE と混ぜ、長さはクリップに揃える', () => {
    const graph = transitionAudioGraph({ se: { file: 'se.mp3', volume: 0.8 } });
    assert.ok(graph.startsWith(`[0:a]${AUDIO_RESAMPLE},`));
    assert.match(graph, /volume=0\.8\[tse\]/);
    assert.match(graph, /amix=inputs=2:duration=first:dropout_transition=0:normalize=0\[a\]$/);
    assert.doesNotMatch(graph, /apad|shortest/);
    assert.equal(transitionAudioGraph({ se: null }), null);
  });

  it('SE があるときは -vf の映像列も filter_complex に包んで [v] と [a] を出す', () => {
    const args = clipFfmpegArgs('src.mp4', {
      vf: 'scale=1920:1080,split=3[x0][x1][x2];[x0][x1]overlay[x3];[x3][x2]overlay',
      audio: '[0:a]anull[a]',
      inputs: ['se.mp3'],
    }, 'out.mp4', DEFAULTS);
    const complex = args[args.indexOf('-filter_complex') + 1];
    assert.equal(complex, '[0:v]scale=1920:1080,split=3[x0][x1][x2];[x0][x1]overlay[x3];[x3][x2]overlay[v];[0:a]anull[a]');
    assert.deepEqual(args.slice(1, 5), ['-i', 'src.mp4', '-i', 'se.mp3']);
    assert.ok(!args.includes('-af'));
    assert.ok(!args.includes('-shortest'));
  });

  it('SE が無ければ従来どおり -vf と -af', () => {
    const args = clipFfmpegArgs('src.mp4', { vf: 'scale=1920:1080' }, 'out.mp4', DEFAULTS);
    assert.ok(args.includes('-vf'));
    assert.ok(args.includes('-af'));
    assert.ok(!args.includes('-filter_complex'));
  });
});

describe('QC の検査位置', () => {
  it('入りのトランジションがあれば区間の後まで送る', () => {
    assert.equal(afterTransitionIn({ transition: { in: { start: 0, end: 0.25 } } }, 0.2), 0.3);
    assert.equal(afterTransitionIn({ transition: { in: null } }, 0.2), 0.2);
    assert.equal(afterTransitionIn({}, 0.2), 0.2);
  });
});
