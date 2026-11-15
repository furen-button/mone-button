import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  loadProject,
  beatTime,
  barTime,
  timelineStart,
  timelineDuration,
  makeBeats,
  nextOutput,
  readJson,
  root,
} from './project.js';
import { framePadding, correlate, measure, wavBuffer } from './audio.js';
import { unitsOf, validateUnits } from './units.js';
import { buildScore, laughBars, chooseOctave, videoSlots } from './score.js';
import { midiBuffer, vlq } from './midi.js';
import { premiereXml, markers, pathUrl } from './premiere-xml.js';
import { importBoundaries, pitchNotes } from './samples.js';
import { videoFilter } from './render-video.js';
const { project: p, melody, boundaries } = loadProject();
function fixtureSamples() {
  const reference = readJson(new URL('./__fixtures__/proto-02-score.json', import.meta.url));
  return Object.fromEntries(
    Object.entries(p.voices).map(([voice, v]) => {
      const b = boundaries.clips[v.base];
      const measured = b.units.map((_, unit) => {
        const e = reference.find(
          (e) => e.phrase === voice && e.unit === unit && e.semis !== undefined,
        );
        return { midi: e ? e.midi - e.semis : 70, f0Std: 0.5 };
      });
      return [
        v.base,
        {
          base: v.base,
          ...b,
          measured,
          hqOffsetSec: 0.035,
          clipVideo: `samples/${v.category}/01_${v.base}/clip.mp4`,
        },
      ];
    }),
  );
}
const samples = fixtureSamples();
function scoreFixture() {
  return videoSlots(buildScore(p, melody, samples), timelineDuration(p), p.output.fps).map((e) => ({
    ...e,
    audioFrames: 20,
    audioSamples: 16000,
    sourceInfo: { duration: 10, fps: 60, width: 1920, height: 1080 },
  }));
}
test('拍と小節・プリロールの時刻', () => {
  assert.equal(beatTime(p, 104), 0.045 + (104 * 60) / 168);
  assert.equal(timelineStart(p), barTime(p, 51));
  assert.ok(Math.abs(timelineDuration(p) - (40 * 2 * 60) / 168) < 1e-12);
  const b = makeBeats(p);
  assert.equal(b.length, 80);
  assert.equal(b[0].bar, 51);
  assert.equal(b[0].frame, 0);
  assert.equal(b.at(-1).bar, 90);
});
test('モーラを試作と同じ規則でまとめる', () => {
  assert.deepEqual(unitsOf('ふとんがふっとんだ'), ['ふ', 'とん', 'が', 'ふっ', 'とん', 'だ']);
  assert.deepEqual(unitsOf('じりつざむらい'), ['じ', 'り', 'つ', 'ざ', 'む', 'らい']);
  assert.deepEqual(unitsOf('うめしゅがうめえ'), ['う', 'め', 'しゅ', 'が', 'う', 'めえ']);
  assert.deepEqual(unitsOf('コウヒー'), ['こう', 'ひー']);
});
test('笑い声の小節と譜面 97 イベントが試作に一致', () => {
  assert.deepEqual(laughBars(p, melody), [58, 60, 66, 68, 74, 76, 82, 84]);
  const score = buildScore(p, melody, samples);
  const reference = readJson(new URL('./__fixtures__/proto-02-score.json', import.meta.url));
  assert.equal(melody.length, 93);
  assert.equal(score.length, 97);
  const actual = score.filter((e) => e.kind === 'melody');
  const expected = reference.filter((e) => e.unit !== null);
  assert.deepEqual(
    actual.map((e) => [e.beat, e.voice, e.unit, e.dur, e.midi]),
    expected.map((e) => [e.beat, e.phrase, e.unit, e.dur, e.midi]),
  );
  assert.deepEqual(
    score.filter((e) => e.kind === 'accent').map((e) => [e.bar, e.units, e.semis]),
    [
      [62, [0, 1], 0],
      [70, [0, 1], 0],
      [78, [0, 1], 0],
      [88, [0, 1], 0],
    ],
  );
});
test('ずらし量の中央値の絶対値でオクターブ選択', () => {
  assert.equal(
    chooseOctave([
      [86, 63],
      [84, 62],
    ]),
    -24,
  );
  assert.equal(
    chooseOctave([
      [79, 70],
      [81, 71],
    ]),
    -12,
  );
  assert.equal(
    chooseOctave([
      [67, 68],
      [69, 70],
    ]),
    0,
  );
});
test('WAV の先頭無音と XML 位置を足すとサンプル位置が厳密に一致', () => {
  for (const fps of [24, 30, 60]) {
    for (const sr of [44100, 48000]) {
      for (let i = 0; i < 3000; i++) {
        const t = i * 0.013719;
        const pad = framePadding(t, fps, sr);
        assert.ok(pad.silenceSamples >= 0);
        assert.ok(pad.silenceSamples <= Math.ceil(sr / fps));
        const x = new Float32Array(pad.silenceSamples + 4);
        x[pad.silenceSamples] = 1;
        const wav = wavBuffer(x, sr);
        const first = Array.from({ length: x.length }, (_, i) =>
          wav.readInt16LE(44 + i * 2),
        ).findIndex((v) => v !== 0);
        assert.equal(Math.round((pad.frame * sr) / fps) + first, Math.round(t * sr));
      }
    }
  }
});
test('音声相互相関の符号・正負のずれ', () => {
  let seed = 7;
  const a = Float32Array.from({ length: 3000 }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  });
  for (const lag of [-37, 43]) {
    const b = Float32Array.from({ length: 3000 }, (_, i) => a[i - lag] || 0);
    const result = correlate(a, b, 1000, 0.1);
    assert.equal(result.offsetSec, lag / 1000);
    assert.ok(result.correlation > 0.999);
  }
});
test('YIN で 440Hz を測る', () => {
  const sr = 44100;
  const x = Float32Array.from(
    { length: sr / 5 },
    (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / sr),
  );
  const m = measure(x, sr);
  assert.ok(Math.abs(m.midi - 69) < 0.05);
  assert.ok(m.f0Std < 0.01);
});
test('MIDI format 0・テンポ・480 tpq・デルタのバイト列', () => {
  assert.deepEqual(vlq(0), [0]);
  assert.deepEqual(vlq(480), [0x83, 0x60]);
  const b = midiBuffer([{ beat: 2, len: 1, midi: 60 }], 168, 0);
  assert.equal(b.toString('ascii', 0, 4), 'MThd');
  assert.equal(b.readUInt16BE(8), 0);
  assert.equal(b.readUInt16BE(10), 1);
  assert.equal(b.readUInt16BE(12), 480);
  assert.equal(b.toString('ascii', 14, 18), 'MTrk');
  assert.equal(b.readUInt32BE(18), b.length - 22);
  assert.deepEqual([...b.subarray(22, 29)], [0, 255, 81, 3, 5, 115, 23]);
  assert.deepEqual(
    [...b.subarray(29)],
    [0x87, 0x40, 0x90, 60, 96, 0x83, 0x60, 0x80, 60, 0, 0, 255, 47, 0],
  );
});
test('映像は累積フレーム境界で連続する・効果を焼く', () => {
  const s = scoreFixture();
  for (let i = 1; i < s.length; i++) {
    assert.equal(s[i - 1].videoEndFrame, s[i].videoStartFrame);
  }
  assert.equal(
    s.reduce((n, e) => n + e.videoFrames, 0) + s[0].videoStartFrame,
    Math.round(timelineDuration(p) * 60),
  );
  assert.ok(videoFilter(p, { zoom: 1.4, hflip: true }).includes('scale=2688:1512'));
  assert.ok(videoFilter(p, { zoom: 1, hflip: true }).endsWith('hflip'));
});
test('FCP7 XML のトラック・イベント・マーカー・参照・位置の構造', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otomad-xml-'));
  try {
    const s = scoreFixture();
    const beats = makeBeats(p);
    const xml = premiereXml(p, s, beats, path.join(dir, '日本語 #素材'));
    const f = path.join(dir, 'test.xml');
    fs.writeFileSync(f, xml);
    const check = spawnSync('xmllint', ['--noout', f], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    const xp = (expr) => {
      const r = spawnSync('xmllint', ['--xpath', expr, f], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    assert.equal(xp('count(/xmeml/sequence/media/video/track)'), '1');
    assert.equal(xp('count(/xmeml/sequence/media/audio/track)'), '4');
    assert.equal(xp('count(//video/track/clipitem)'), '97');
    assert.equal(xp('count(/xmeml/sequence/media/audio/track[2]/clipitem)'), '93');
    assert.equal(xp('count(/xmeml/sequence/media/audio/track[3]/clipitem)'), '4');
    assert.equal(xp('string(/xmeml/sequence/media/audio/track[4]/clipitem/enabled)'), 'FALSE');
    assert.equal(Number(xp('count(/xmeml/sequence/marker)')), markers(p, beats, s).length);
    assert.ok(xml.includes('小節 56｜1 句目（布団が吹っ飛んだ）'));
    assert.ok(xml.includes('file://localhost/'));
    assert.ok(xml.includes('%23'));
    const clips = [...xml.matchAll(/<clipitem\b[^>]*>([\s\S]*?)<\/clipitem>/g)];
    for (const [, c] of clips) {
      const get = (n) => Number(c.match(new RegExp(`<${n}>(.*?)</${n}>`))[1]);
      assert.ok(get('end') > get('start'));
      assert.ok(get('out') > get('in'));
      assert.equal(get('end') - get('start'), get('out') - get('in'));
    }
    const ids = [...xml.matchAll(/<file id="([^"]+)">/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length);
    for (const [, id] of xml.matchAll(/<file id="([^"]+)"\/>/g)) {
      assert.ok(ids.includes(id));
    }
    assert.ok(pathUrl('/tmp/a #あ.wav').endsWith('/a%20%23%E3%81%82.wav'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('素材不足は最後のフレームを止めた別ファイル（clip-hold.mp4）で埋める', () => {
  const score = scoreFixture();
  const last = score.at(-1);
  last.sourceInfo.duration = 0.5;
  last.holdFile = 'samples/x/clip-hold.mp4';
  const xml = premiereXml(p, score, makeBeats(p), '/tmp/assets');
  assert.ok(xml.includes('最終フレーム静止'));
  assert.ok(xml.includes('<pathurl>file://localhost/tmp/assets/samples/x/clip-hold.mp4</pathurl>'));
  assert.ok(!xml.includes('<effectid>timeremap</effectid>'));
  assert.ok(!xml.includes('<pathurl>file://localhost/tmp/assets/video/cut/'));
  // 静止クリップを足しても V1 の最後はタイムライン上でイベントの終わりに一致する。
  const ends = [
    ...xml.matchAll(
      new RegExp(
        String.raw`<clipitem id="clip-\d+"><name>[^<]*</name><enabled>TRUE</enabled>` +
          String.raw`<duration>\d+</duration><rate><timebase>60</timebase>` +
          String.raw`<ntsc>FALSE</ntsc></rate><start>(\d+)</start><end>(\d+)</end>`,
        'g',
      ),
    ),
  ];
  assert.ok(ends.some((m) => Number(m[2]) === last.videoEndFrame));
});
test('連番・境界取り込み・ト長調音階', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otomad-boundary-'));
  try {
    for (const n of ['assets-01', 'assets-09', 'assets-100', 'assets-no']) {
      fs.mkdirSync(path.join(dir, n));
    }
    assert.equal(path.basename(nextOutput(p, dir)), 'assets-101');
    const b = Object.keys(boundaries.clips)[0];
    const units = structuredClone(boundaries.clips[b].units);
    units[0][1] += 0.001;
    fs.writeFileSync(path.join(dir, 'boundaries.json'), JSON.stringify(boundaries));
    fs.mkdirSync(path.join(dir, 'samples/a'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'samples/a/units.json'),
      JSON.stringify({
        base: b,
        reading: 'テスト',
        reference: 'public/videos',
        source: 'manual',
        units,
      }),
    );
    const logs = [];
    assert.equal(
      importBoundaries(dir, dir, (l) => logs.push(l)),
      1,
    );
    assert.ok(logs[0].includes('→'));
    assert.deepEqual(readJson(path.join(dir, 'boundaries.json')).clips[b].units, units);
    assert.equal(
      importBoundaries(dir, dir, () => {}),
      0,
    );
    assert.throws(() => validateUnits([['あ', 0, 2, 1]]));
    assert.deepEqual(pitchNotes(69), [62, 64, 66, 67, 69, 71, 72, 74, 76]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('外部コマンドがなければ理由を示して出力前に停止', () => {
  const r = spawnSync(
    process.execPath,
    [
      new URL('./index.js', import.meta.url).pathname,
      '--no-download',
      '--no-pitch-pack',
      '--candidates',
      '2',
    ],
    { encoding: 'utf8', env: { ...process.env, FFMPEG_BIN: '/存在しない/ffmpeg' } },
  );
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('音MAD 素材の生成を停止'));
  assert.ok(r.stderr.includes('ENOENT'));
  assert.ok(!r.stdout.includes('出力先:'));
});

test('候補の山と谷の検出・短音と無声の取り扱い', async () => {
  const { nucleiSegment, analyzeClip, usability } = await import('./units.js');
  const frames = Array.from({ length: 70 }, (_, i) => ({
    time: (i * 256 + 1024) / 44100,
    f0: (i >= 8 && i <= 22) || (i >= 42 && i <= 58) ? 220 : 0,
    db:
      (i >= 8 && i <= 22) || (i >= 42 && i <= 58)
        ? -18 - Math.abs(i - (i < 30 ? 15 : 50)) * 0.3
        : -65,
  }));
  const units = nucleiSegment(frames, 0.5);
  assert.equal(units.length, 2);
  assert.ok(units[0][2] <= units[1][1]);
  assert.deepEqual(analyzeClip(new Float32Array(500), 'あ').units, []);
  const score = usability(
    {
      frames,
      units: units.map((u, i) => [String(i), ...u]),
      measured: [{ f0Std: 0.1 }, { f0Std: 0.2 }],
    },
    0.5,
    '笑い声',
  );
  assert.equal(score.peakCount, 2);
  assert.ok(score.valleyDepthDb > 30);
  assert.ok(score.components.laugh > 0);
});

test('XML は異なる元 fps と曲のゲインを保持する', () => {
  const s = scoreFixture();
  s[0].sourceInfo = { ...s[0].sourceInfo, fps: 30 };
  s[1].sourceInfo = { ...s[1].sourceInfo, fps: 30000 / 1001 };
  const xml = premiereXml(p, s, makeBeats(p), '/tmp/assets');
  assert.ok(xml.includes('<effectid>audiolevels</effectid>'));
  assert.ok(xml.includes('<value>0.45</value>'));
  assert.ok(xml.includes('<rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate>'));
  assert.ok(xml.includes('<rate><timebase>60</timebase><ntsc>FALSE</ntsc></rate>'));
});

test('YIN は試作と同じフレーム数を使い、余りのフレームを増やさない', async () => {
  const { yin } = await import('./audio.js');
  for (const n of [2048, 2049, 2303, 2304, 2305, 4096]) {
    assert.equal(yin(new Float32Array(n)).length, Math.max(0, Math.floor((n - 2048) / 256)));
  }
});

test(
  '実素材の音節 f0 から求めた移調量も試作の小数2桁記録に一致',
  {
    skip: !Object.values(p.voices).every((v) =>
      fs.existsSync(path.join(root, 'public/videos', v.base + '.mp4')),
    ),
  },
  async () => {
    const { decode, resolveTools } = await import('./audio.js');
    const { analyzeClip } = await import('./units.js');
    const tools = resolveTools();
    const real = {};
    for (const v of Object.values(p.voices)) {
      const b = boundaries.clips[v.base];
      real[v.base] = {
        base: v.base,
        clipVideo: 'unused.mp4',
        hqOffsetSec: 0,
        ...analyzeClip(
          decode(path.join(root, 'public/videos', v.base + '.mp4'), tools, 44100),
          b.reading,
          b.units,
        ),
      };
    }
    const score = buildScore(p, melody, real).filter((e) => e.kind === 'melody');
    const reference = readJson(
      new URL('./__fixtures__/proto-02-score.json', import.meta.url),
    ).filter((e) => e.unit !== null);
    for (const [i, e] of score.entries()) {
      assert.equal(e.midi, reference[i].midi);
      assert.ok(
        Math.abs(e.semis - reference[i].semis) < 0.0051,
        `${e.voice} ${e.unit}: ${e.semis} / ${reference[i].semis}`,
      );
    }
  },
);
