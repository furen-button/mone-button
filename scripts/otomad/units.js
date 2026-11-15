import { measure, median } from './audio.js';
const small = new Set('ゃゅょぁぃぅぇぉゎ');
const merge = new Set('んっー');
const vowels = {};
for (const [row, v] of [
  ['あかさたなはまやらわがざだばぱ', 'a'],
  ['いきしちにひみりぎじぢびぴ', 'i'],
  ['うくすつぬふむゆるぐずづぶぷ', 'u'],
  ['えけせてねへめれげぜでべぺ', 'e'],
  ['おこそとのほもよろをごぞどぼぽ', 'o'],
]) {
  for (const c of row) {
    vowels[c] = v;
  }
}

/** 読みを試作と同じ規則で音節へ分ける。 */
export function unitsOf(reading) {
  const out = [];
  for (const c of reading
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[^ぁ-ゖー]/g, '')) {
    const prev = out.at(-1);
    const v = prev && !small.has(prev.at(-1)) ? vowels[prev.at(-1)] : null;
    if (
      prev &&
      (small.has(c) ||
        merge.has(c) ||
        ('あいうえお'.includes(c) && (c === 'い' || vowels[c] === v || (c === 'う' && v === 'o'))))
    ) {
      out[out.length - 1] += c;
    } else {
      out.push(c);
    }
  }
  return out;
}

/** 入力動画の秒基準で音節境界の順序と範囲を検証する。 */
export function validateUnits(units, duration = Infinity) {
  if (!Array.isArray(units) || !units.length) {
    throw new Error('音節の境界が空です');
  }
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (
      !Array.isArray(u) ||
      u.length !== 4 ||
      typeof u[0] !== 'string' ||
      !u.slice(1).every(Number.isFinite) ||
      !(0 <= u[1] && u[1] <= u[2] && u[2] < u[3] && u[3] <= duration + 0.03) ||
      (i && u[1] < units[i - 1][1])
    ) {
      throw new Error(`音節 ${i + 1} の境界が不正です: ${JSON.stringify(u)}`);
    }
  }
}

/** 解析フレームから入力音声の秒基準で母音区間を推定する。 */
export function nucleiSegment(frames, duration, sr = 44100) {
  if (!frames.length) {
    return [];
  }
  const top = Math.max(...frames.map((f) => f.db));
  const voiced = frames.map((f) => f.f0 > 0 && f.db > top - 30);
  const e = frames.map((f, i) => (voiced[i] ? f.db : top - 60));
  const sm = e.map((_, i) => (e[Math.max(0, i - 1)] + e[i] + e[Math.min(e.length - 1, i + 1)]) / 3);
  const peaks = [];
  for (let i = 1; i < sm.length - 1; i++) {
    if (voiced[i] && sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1]) {
      peaks.push(i);
    }
  }
  peaks.sort((a, b) => sm[b] - sm[a]);
  const keep = [];
  for (const i of peaks) {
    if (keep.every((j) => Math.abs(frames[i].time - frames[j].time) >= 0.09)) {
      keep.push(i);
    }
  }
  keep.sort((a, b) => a - b);
  const valley = (a, b) => {
    let k = a;
    for (let i = a + 1; i <= b; i++) {
      if (sm[i] < sm[k]) {
        k = i;
      }
    }
    return k;
  };
  const merged = [];
  for (const i of keep) {
    const a = merged.at(-1);
    if (
      a !== undefined &&
      Math.min(sm[a], sm[i]) - sm[valley(a, i)] < 3 &&
      voiced.slice(a, i + 1).every(Boolean)
    ) {
      if (sm[i] > sm[a]) {
        merged[merged.length - 1] = i;
      }
    } else {
      merged.push(i);
    }
  }
  const active = frames.map((f, i) => (f.db > top - 32 ? i : -1)).filter((i) => i >= 0);
  if (!merged.length || top < -70 || !active.length) {
    return [];
  }
  const bounds = [
    active[0],
    ...merged.slice(1).map((b, i) => valley(merged[i], b)),
    active.at(-1) + 1,
  ];
  return bounds.slice(0, -1).flatMap((a, i) => {
    const b = bounds[i + 1];
    const on = voiced.findIndex((v, k) => k >= a && k < b && v);
    if (on < 0) {
      return [];
    }
    const start = Math.max(0, frames[a].time - 1024 / sr + 0.02);
    const end = Math.min(duration, frames[Math.min(b, frames.length - 1)].time - 1024 / sr + 0.04);
    return end > start
      ? [[start, Math.max(start, Math.min(end - 1 / sr, frames[on].time - 1024 / sr + 0.02)), end]]
      : [];
  });
}

/** 入力音声の秒基準で音節境界と音高を解析する。 */
export function analyzeClip(x, reading, manual, sr = 44100) {
  const measured = measure(x, sr);
  const duration = x.length / sr;
  const kana = unitsOf(reading);
  const segments =
    manual ||
    nucleiSegment(measured.frames, duration, sr).map((u, i, all) => [
      kana.length === all.length ? kana[i] : `#${i + 1}`,
      ...u,
    ]);
  if (!segments.length) {
    return { units: [], measured: [], frames: measured.frames };
  }
  validateUnits(segments, duration);
  const ms = segments.map(([, , on, b]) => {
    const m = measure(x.subarray(Math.floor(on * sr), Math.floor(b * sr)), sr);
    return { midi: m.midi, f0Std: m.f0Std };
  });
  const fallback = median(ms.map((m) => m.midi).filter((m) => m !== null)) ?? 60;
  return {
    units: segments,
    measured: ms.map((m) => ({ ...m, midi: m.midi ?? fallback })),
    frames: measured.frames,
  };
}

/** 音量差・有声率・音高の安定性から素材を評価する。 */
export function usability(analysis, duration, category) {
  const frames = analysis.frames;
  const db = frames.map((f) => f.db).sort((a, b) => a - b);
  const percentile = (p) => db[Math.min(db.length - 1, Math.floor(db.length * p))] ?? -90;
  const contrastDb = percentile(0.95) - percentile(0.1);
  const voicedRatio = frames.filter((f) => f.f0 > 0).length / (frames.length || 1);
  const std = median(analysis.measured.map((m) => m.f0Std).filter(Number.isFinite)) ?? 12;
  const peaks = analysis.units
    .map(([, a, , b]) => {
      let peak = -1;
      for (let i = 0; i < frames.length; i++) {
        if (
          frames[i].time >= a &&
          frames[i].time < b &&
          frames[i].f0 > 0 &&
          (peak < 0 || frames[i].db > frames[peak].db)
        ) {
          peak = i;
        }
      }
      return peak;
    })
    .filter((i) => i >= 0);
  const peakCount = peaks.length;
  const depths = [];
  for (let i = 1; i < peaks.length; i++) {
    const a = peaks[i - 1];
    const b = peaks[i];
    const valley = Math.min(...frames.slice(a, b + 1).map((f) => f.db));
    depths.push(Math.max(0, Math.min(frames[a].db, frames[b].db) - valley));
  }
  const valleyDepthDb = median(depths) ?? 0;
  const components = {
    contrast: Math.min(30, contrastDb) * 0.7,
    voiced: voicedRatio * 25,
    stability: 20 / (1 + std),
    brevity: 10 / (0.5 + duration),
    laugh:
      category === '笑い声' ? Math.min(10, peakCount) * 1.5 + Math.min(30, valleyDepthDb) * 0.3 : 0,
  };
  return {
    total: Object.values(components).reduce((a, b) => a + b, 0),
    components,
    contrastDb,
    voicedRatio,
    f0Std: std,
    peakCount,
    valleyDepthDb,
  };
}
