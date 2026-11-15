import { beatTime, timelineStart, sectionAt, noteName, safeName } from './project.js';
import { median, framePadding } from './audio.js';

/** 原曲の拍基準の旋律から笑い声を入れる小節を選ぶ。 */
export function laughBars(p, melody) {
  const bars = new Map();
  for (const n of melody) {
    const b = Math.floor(n.beat / p.beat.beatsPerBar);
    if (!bars.has(b)) {
      bars.set(b, []);
    }
    bars.get(b).push(n.midi);
  }
  const r = p.laughBars;
  return [...bars]
    .filter(
      ([b, ns]) =>
        b >= r.phraseStartBar &&
        r.barInPhrase.includes((b - r.phraseStartBar) % r.phraseLength) &&
        ns.length >= 2 &&
        new Set(ns).size === 1,
    )
    .map(([b]) => b)
    .sort((a, b) => a - b);
}

/** 目標と素材の音高差が小さくなるオクターブを選ぶ。 */
export function chooseOctave(pairs, choices = [-24, -12, 0]) {
  return choices.reduce(
    (best, o) =>
      Math.abs(median(pairs.map(([target, source]) => target + o - source))) <
      Math.abs(median(pairs.map(([target, source]) => target + best - source)))
        ? o
        : best,
    choices[0],
  );
}

/** 原曲の拍・秒とタイムライン秒を持つイベント譜面を作る。 */
export function buildScore(p, melody, samples) {
  const laughs = new Set(laughBars(p, melody));
  const counters = new Map();
  let laughIndex = 0;
  let flipIndex = 0;
  const events = melody.map((n, i) => {
    const bar = Math.floor(n.beat / p.beat.beatsPerBar);
    const section = sectionAt(p, bar);
    const voice = laughs.has(bar) ? p.laughBars.voice : section.voice;
    const v = p.voices[voice];
    const sample = samples[v.base];
    const dur = Math.min(1, (melody[i + 1]?.beat ?? n.beat + n.len) - n.beat);
    let unit;
    if (v.mode === 'percussive') {
      unit = (dur * 60) / p.beat.bpm >= v.longNoteSec ? v.longUnit : laughIndex++ % v.longUnit;
    } else {
      // 試作の数え方: 声と 8 小節ブロックでカウンターを分け、笑い声では進めない。
      const key = `${voice}:${Math.floor(bar / p.laughBars.phraseLength)}`;
      const count = counters.get(key) || 0;
      counters.set(key, count + 1);
      unit = count % sample.units.length;
    }
    return {
      beat: n.beat,
      dur,
      originalMidi: n.midi,
      voice,
      phrase: voice,
      unit,
      section: section.name,
      sectionStart: section.fromBar,
      bar,
      kind: 'melody',
      fx: {
        zoom: section.name === '導入' ? 1 + 0.15 * (bar - section.fromBar) : 1,
        hflip: laughs.has(bar) ? flipIndex++ % 2 === 1 : false,
      },
    };
  });
  // 同じ声の句をまとめて選ぶ（試作と同じ。笑い声のみ音単位）。
  for (const e of events) {
    const group =
      p.voices[e.voice].mode === 'percussive' ? [e] : events.filter((x) => x.voice === e.voice);
    const octave = chooseOctave(
      group.map((x) => [x.originalMidi, samples[p.voices[x.voice].base].measured[x.unit].midi]),
      p.output.voiceTransposeChoices,
    );
    e.midi = e.originalMidi + octave;
    e.octave = octave;
  }
  for (const a of p.accents) {
    events.push({
      ...a,
      beat: a.bar * p.beat.beatsPerBar + a.beatInBar,
      phrase: a.voice,
      kind: 'accent',
      midi: null,
      unit: null,
      fx: { zoom: 1.4, hflip: false },
      section: sectionAt(p, a.bar)?.name,
    });
  }
  events.sort((a, b) => a.beat - b.beat || (a.kind === 'accent' ? 1 : -1));
  return events.map((e, i) => {
    const s = samples[p.voices[e.voice].base];
    const indices = e.units || [e.unit];
    const first = s.units[indices[0]];
    const last = s.units[indices.at(-1)];
    const preRoll =
      e.kind === 'accent' ? 0.02 : Math.min(p.output.preRollMaxSec, first[2] - first[1]);
    const targetSec =
      e.kind === 'accent' ? last[3] - first[1] : (e.dur * 60) / p.beat.bpm + preRoll;
    const sourceSec = last[3] - first[1];
    const stretch =
      e.kind === 'accent'
        ? 1
        : sourceSec < targetSec * 0.85
          ? Math.min(targetSec / sourceSec, p.output.maxStretch)
          : 1;
    const timeSec = beatTime(p, e.beat);
    const timelineSec = timeSec - timelineStart(p);
    const onsetSec = timelineSec - preRoll;
    const kana = indices.map((k) => s.units[k][0]).join('');
    const name =
      `${String(i + 1).padStart(3, '0')}_b${e.bar}-${Number((e.beat % p.beat.beatsPerBar).toFixed(3))}` +
      `_${safeName(p.voices[e.voice].label)}_${safeName(kana)}_${e.midi === null ? '原音' : noteName(e.midi)}`;
    return {
      ...e,
      id: i + 1,
      timeSec,
      timelineSec,
      onsetSec,
      beatInBar: e.beat % p.beat.beatsPerBar,
      kana,
      pitch: e.midi === null ? null : noteName(e.midi),
      semis: e.kind === 'accent' ? 0 : e.midi - s.measured[e.unit].midi,
      stretch,
      preRoll,
      targetSec,
      sourceStart: first[1],
      sourceEnd: last[3],
      hqSourceStart: Math.max(0, first[1] + s.hqOffsetSec),
      audioOffsetSec: s.audioOffsetSec ?? 0,
      lowQuality: !!s.lowQuality,
      base: s.base,
      sampleFile: s.clipVideo,
      holdFile: s.clipHold,
      audioFile: `audio/events/${name}.wav`,
      videoFile: `video/cut/${name}.mp4`,
      padding: framePadding(onsetSec, p.output.fps, p.output.sampleRate),
    };
  });
}

/** タイムライン秒から連続する映像フレーム区間を割り当てる。 */
export function videoSlots(events, duration, fps) {
  return events.map((e, i) => {
    const start = Math.round(e.timelineSec * fps);
    const end = Math.round((events[i + 1]?.timelineSec ?? duration) * fps);
    return {
      ...e,
      videoStartFrame: start,
      videoEndFrame: end,
      videoFrames: Math.max(0, end - start),
    };
  });
}
