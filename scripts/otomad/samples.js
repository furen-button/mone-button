import fs from 'node:fs';
import path from 'node:path';
import { readAllClips } from '../create-video/select.js';
import { downloadHighQuality } from '../create-video/assets.js';
import { root, readJson, writeJson, csv, safeName, noteName } from './project.js';
import { decode, run, correlate, fade, cleanUnit, writeWav, median } from './audio.js';
import { analyzeClip, usability, validateUnits } from './units.js';

/** 低画質動画基準の手動音節境界をプロジェクトへ取り込む。 */
export function importBoundaries(assetsDir, projectDir, log = console.log) {
  const file = path.join(projectDir, 'boundaries.json');
  const doc = readJson(file);
  const changes = new Map();
  function visit(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        visit(f);
      } else {
        if (ent.name === 'units.json') {
          const j = readJson(f);
          if (j.source !== 'manual') {
            continue;
          }
          if (j.reference !== 'public/videos' || !/^[\w-]+$/.test(j.base)) {
            throw new Error(`境界の基準または base が不正です: ${f}`);
          }
          validateUnits(j.units);
          if (!fs.existsSync(path.join(root, 'public/data', j.base + '.json'))) {
            throw new Error(`未知のクリップです: ${j.base}`);
          }
          const lowDuration = Number(
            readJson(path.join(root, 'public/data', j.base + '.json')).trimming?.duration,
          );
          if (lowDuration > 0) {
            validateUnits(j.units, lowDuration);
          }
          const value = { ...(doc.clips[j.base] || {}), reading: j.reading, units: j.units };
          if (
            changes.has(j.base) &&
            JSON.stringify(changes.get(j.base)) !== JSON.stringify(value)
          ) {
            throw new Error(`同じ素材に異なる手動境界があります: ${j.base}`);
          }
          changes.set(j.base, value);
        }
      }
    }
  }
  visit(path.join(path.resolve(assetsDir), 'samples'));
  let n = 0;
  for (const [base, value] of changes) {
    if (JSON.stringify(doc.clips[base]) === JSON.stringify(value)) {
      continue;
    }
    log(
      `境界の差分 ${base}: ${JSON.stringify(doc.clips[base] || null)} → ${JSON.stringify(value)}`,
    );
    doc.clips[base] = value;
    n++;
  }
  if (n) {
    writeJson(file, doc);
  }
  log(`手動境界を ${n} 件取り込みました`);
  return n;
}

/** 指定音高の前後 7 半音からト長調の MIDI 音高を選ぶ。 */
export function pitchNotes(midi) {
  const out = [];
  for (let m = Math.ceil(midi - 7); m <= Math.floor(midi + 7); m++) {
    if (m >= 0 && m <= 127 && [7, 9, 11, 0, 2, 4, 6].includes(m % 12)) {
      out.push(m);
    }
  }
  return out;
}
function spectrogram(tools, file, out, units, duration) {
  const width = 1600;
  const height = 600;
  const boxes = [];
  for (let t = 0; t <= duration; t += 0.1) {
    boxes.push(`drawbox=x=${Math.round((t / duration) * width)}:y=580:w=1:h=20:color=gray:t=fill`);
  }
  for (const [, a, on] of units) {
    for (const [t, color] of [
      [a, 'white'],
      [on, 'lime'],
    ]) {
      boxes.push(
        `drawbox=x=${Math.min(width - 1, Math.round((t / duration) * width))}` +
          `:y=0:w=2:h=${height}:color=${color}:t=fill`,
      );
    }
  }
  if (tools.drawtext) {
    // 音節の番号とかなを開始線の右に（重ならないよう上下 2 段で交互に）、0.5 秒ごとの秒数を下端に描く。
    const quote = (s) => String(s).replace(/['\\:]/g, '');
    const text = (label, x, y, size) =>
      `drawtext=font='Hiragino Sans':text='${quote(label)}':x=${x}:y=${y}:fontsize=${size}` +
      ':fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4';
    units.forEach(([kana, a], i) => {
      const x = Math.min(width - 60, Math.round((a / duration) * width) + 4);
      boxes.push(text(`${i + 1} ${kana}`, x, i % 2 === 0 ? 6 : 44, 26));
    });
    for (let t = 0.5; t < duration; t += 0.5) {
      boxes.push(text(`${t.toFixed(1)}s`, Math.round((t / duration) * width) + 3, 552, 20));
    }
  }
  run(tools.ffmpeg, [
    '-y',
    '-v',
    'error',
    '-i',
    file,
    '-filter_complex',
    `showspectrumpic=s=${width}x${height}:legend=disabled:scale=log:fs` +
      `cale=lin:start=0:stop=4000${boxes.length ? ',' + boxes.join(',') : ''}`,
    '-frames:v',
    '1',
    out,
  ]);
}

/**
 * 元動画をシーケンスと同じ大きさ・一定 fps・48kHz に揃えて書く。
 * 時刻の 0 は元動画の先頭のまま（fps フィルタはタイムスタンプを保つ）。
 */
export function transcodeClip(tools, input, output, { width, height, fps, sampleRate }) {
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    `fps=${fps}`,
  ].join(',');
  run(tools.ffmpeg, [
    '-y',
    '-v',
    'error',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '16',
    '-pix_fmt',
    'yuv420p',
    '-r',
    fps,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    sampleRate,
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    output,
  ]);
}

/** 元動画の最後のフレームを 10 秒止めた映像を書く（Premiere で元動画が足りない区間に置く）。 */
export function holdClip(tools, input, output, { fps }) {
  run(tools.ffmpeg, [
    '-y',
    '-v',
    'error',
    '-sseof',
    '-0.5',
    '-i',
    input,
    '-vf',
    `reverse,trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=10,fps=${fps}`,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '16',
    '-pix_fmt',
    'yuv420p',
    '-r',
    fps,
    '-t',
    10,
    '-movflags',
    '+faststart',
    output,
  ]);
}

/** 素材を解析し、低画質基準の音節と高画質への時間差を保存する。 */
export function prepareSamples(p, boundaries, out, options, tools, log = console.log) {
  const all = readAllClips();
  const forced = new Set(Object.values(p.voices).map((v) => v.base));
  const pool = all.filter(
    (c) =>
      fs.existsSync(path.join(root, 'public/videos', c.base + '.mp4')) &&
      ((c.endTime - c.startTime <= p.candidates.maxClipSec &&
        p.candidates.categories.some((cat) => c.categories.includes(cat))) ||
        forced.has(c.base)),
  );
  for (const base of forced) {
    if (!pool.some((c) => c.base === base)) {
      throw new Error(`指定素材が見つかりません: ${base}`);
    }
  }
  const analyzed = [];
  for (const [i, clip] of pool.entries()) {
    log(`素材を解析 ${i + 1}/${pool.length}: ${clip.base}`);
    const low = path.join(root, 'public/videos', clip.base + '.mp4');
    const x = decode(low, tools, 44100);
    const manual = boundaries.clips[clip.base];
    const reading = manual?.reading || clip.data.ruby || clip.data.serif || '';
    const analysis = analyzeClip(x, reading, manual?.units);
    if (!analysis.units.length) {
      if (forced.has(clip.base)) {
        throw new Error(`必須素材の有声音節がありません: ${clip.base}`);
      }
      continue;
    }
    const scores = Object.fromEntries(
      p.candidates.categories
        .filter((cat) => clip.categories.includes(cat))
        .map((cat) => [cat, usability(analysis, x.length / 44100, cat)]),
    );
    analyzed.push({
      clip,
      low,
      reading,
      analysis,
      scores,
      duration: x.length / 44100,
      manual: !!manual,
    });
  }
  const selected = [];
  for (const category of p.candidates.categories) {
    const ranked = analyzed
      .filter((a) => a.scores[category])
      .sort(
        (a, b) =>
          b.scores[category].total - a.scores[category].total ||
          a.clip.base.localeCompare(b.clip.base),
      );
    const count = options.candidates ?? p.candidates.perCategory;
    for (const [i, a] of ranked.entries()) {
      if (i < count || forced.has(a.clip.base)) {
        selected.push({
          ...a,
          category,
          rank: i + 1,
          recommended: i < 3,
          pitchPack:
            !options.noPitchPack &&
            (i < p.candidates.pitchPackPerCategory || forced.has(a.clip.base)),
        });
      }
    }
  }
  for (const base of forced) {
    if (!selected.some((a) => a.clip.base === base)) {
      const a = analyzed.find((a) => a.clip.base === base);
      const v = Object.values(p.voices).find((v) => v.base === base);
      selected.push({
        ...a,
        category: v.category,
        rank: 1,
        recommended: true,
        pitchPack: !options.noPitchPack,
      });
    }
  }
  const result = {};
  const index = [];
  for (const a of selected) {
    const { clip, category, rank } = a;
    const dir = path.join(
      'samples',
      safeName(category),
      `${String(rank).padStart(2, '0')}_${clip.base}`,
    );
    const dest = path.join(out, dir);
    fs.mkdirSync(path.join(dest, 'units'), { recursive: true });
    fs.mkdirSync(path.join(dest, 'units-clean'), { recursive: true });
    const forcedClip = forced.has(clip.base);
    const hqCache = path.join(root, 'cache/createVideo', clip.videoId, clip.base + '.mp4');
    const downloadRank = p.candidates.downloadPerCategory ?? p.candidates.pitchPackPerCategory;
    if (!fs.existsSync(hqCache) && !options.noDownload && (forcedClip || rank <= downloadRank)) {
      log(`高画質を取得: ${clip.base}`);
      run('yt-dlp', ['--version']);
      // createVideo と同じ取り方（ffmpeg-normalize で -23 LUFS、44.1kHz）にして、共有キャッシュの中身を揃える。
      downloadHighQuality(clip, hqCache, { normalize: true, tools });
    }
    const sampleRate = p.output.sampleRate;
    const copied = path.join(dest, 'clip.mp4');
    let lowQuality = !fs.existsSync(hqCache);
    let alignment = { offsetSec: 0, correlation: 1 };
    if (!lowQuality) {
      // Premiere で in/out の解釈がぶれないよう、元の fps に関係なくシーケンスと同じ大きさ・fps に揃える。
      transcodeClip(tools, hqCache, copied, p.output);
      alignment = correlate(decode(a.low, tools, 8000), decode(copied, tools, 8000), 8000);
      const unreliable = alignment.correlation < 0.2 || Math.abs(alignment.offsetSec) >= 0.249;
      if (unreliable && forcedClip) {
        throw new Error(
          `高画質の時間差を特定できません: ${clip.base}（相関 ${alignment.correlation.toFixed(3)}` +
            `、差 ${alignment.offsetSec} 秒）`,
        );
      }
      if (unreliable) {
        log(
          `⚠️ 高画質の時間差を特定できないため低画質を使います: ${clip.base}（相関 ${alignment.correlation.toFixed(3)}）`,
        );
        lowQuality = true;
        alignment = { offsetSec: 0, correlation: 1 };
      }
    }
    if (lowQuality) {
      transcodeClip(tools, a.low, copied, p.output);
    }
    holdClip(tools, copied, path.join(dest, 'clip-hold.mp4'), p.output);
    log(
      `素材を書き出し: ${category}/${clip.base}（${lowQuality ? '低画質' : '高画質'}、時` +
        `間差 ${alignment.offsetSec.toFixed(4)} 秒）`,
    );
    // 境界と f0 の解析は public/videos 基準。clip.wav も境界を直すための基準なので低画質のまま書く。
    const lowAudio = decode(a.low, tools, sampleRate);
    writeWav(path.join(dest, 'clip.wav'), lowAudio, sampleRate);
    // 音節の素材は、高画質があればその音声から時間差を足して切る（低画質は AAC 96k の再エンコードで劣化しているため）。
    const audio = lowQuality ? lowAudio : decode(copied, tools, sampleRate);
    const audioOffsetSec = lowQuality ? 0 : alignment.offsetSec;
    const meta = {
      base: clip.base,
      reading: a.reading,
      reference: 'public/videos',
      hqOffsetSec: alignment.offsetSec,
      correlation: alignment.correlation,
      source: a.manual ? 'manual' : 'auto',
      units: a.analysis.units,
      measured: a.analysis.measured,
      lowQuality,
      clipVideo: path.join(dir, 'clip.mp4'),
      clipHold: path.join(dir, 'clip-hold.mp4'),
      audioOffsetSec,
    };
    const medianMidi =
      median(
        a.analysis.frames.filter((f) => f.f0 > 0).map((f) => 69 + 12 * Math.log2(f.f0 / 440)),
      ) ?? median(meta.measured.map((m) => m.midi));
    writeJson(path.join(dest, 'units.json'), meta);
    spectrogram(
      tools,
      path.join(dest, 'clip.wav'),
      path.join(dest, 'spectrogram.png'),
      meta.units,
      a.duration,
    );
    for (const [i, [kana, start, , end]] of meta.units.entries()) {
      const name = `${String(i + 1).padStart(2, '0')}_${safeName(kana)}`;
      const raw = audio.slice(
        Math.max(0, Math.floor((start + audioOffsetSec) * sampleRate)),
        Math.max(0, Math.floor((end + audioOffsetSec) * sampleRate)),
      );
      const unit = path.join(dest, 'units', name + '.wav');
      writeWav(unit, fade(raw, p.output.sampleRate), p.output.sampleRate);
      writeWav(
        path.join(dest, 'units-clean', name + '.wav'),
        cleanUnit(raw, p.output.sampleRate),
        p.output.sampleRate,
      );
      if (a.pitchPack) {
        const pitchDir = path.join(dest, 'pitch', name);
        fs.mkdirSync(pitchDir, { recursive: true });
        const sourceMidi = meta.measured[i].midi;
        for (const m of pitchNotes(medianMidi)) {
          run(tools.rubberband, [
            '-q',
            '-3',
            '-F',
            '-p',
            (m - sourceMidi).toFixed(3),
            '-t',
            '1',
            unit,
            path.join(pitchDir, noteName(m) + '.wav'),
          ]);
        }
      }
    }
    const item = {
      ...meta,
      category,
      rank,
      recommended: a.recommended ? '推奨' : '',
      quality: lowQuality ? '低画質' : '高画質',
      serif: clip.data.serif,
      durationSec: a.duration,
      pitchPack: a.pitchPack,
      score: a.scores[category] || null,
      directory: dir,
    };
    index.push(item);
    result[clip.base] ||= meta;
  }
  writeJson(path.join(out, 'samples/index.json'), index);
  fs.writeFileSync(path.join(out, 'samples/index.csv'), csv(index));
  return { samples: result, index };
}
