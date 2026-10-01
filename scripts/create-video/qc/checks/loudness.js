import { spawnSync } from 'child_process';

export function runMediaScan({ tools, videoPath, config }) {
  const t = config.qc.thresholds;
  const filter = [
    `[0:v]blackdetect=d=${Number(t.blackMinDuration)}:pix_th=0.10,freezedetect=n=-60dB:d=${Number(t.freezeMinDuration)}[vqc]`,
    `[0:a]silencedetect=n=-50dB:d=${Number(t.silenceMinDuration)},ebur128=peak=true[aqc]`,
  ].join(';');
  const proc = spawnSync(tools.ffmpeg, [
    '-hide_banner',
    '-nostats',
    '-i', videoPath,
    '-filter_complex', filter,
    '-map', '[vqc]',
    '-map', '[aqc]',
    '-f', 'null',
    '-',
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

  if (proc.status !== 0) {
    return {
      log: `${proc.stdout || ''}${proc.stderr || ''}`,
      results: [result('warn', 'loudness_scan_failed', `ffmpeg QC スキャンに失敗しました: ${firstLine(proc.stderr)}`)],
    };
  }
  return { log: `${proc.stdout || ''}${proc.stderr || ''}`, results: [] };
}

export function runLoudnessChecks({ scanLog, manifest, config }) {
  const results = [];
  const loudness = parseEbur128(scanLog);
  const silence = parseSilenceDetect(scanLog);
  const t = config.qc.thresholds;

  if (loudness.integratedLufs === null) {
    results.push(result('info', 'loudness_integrated_skip', 'Integrated LUFS を取得できませんでした。'));
  } else if (loudness.integratedLufs < Number(t.integratedLufsMin) || loudness.integratedLufs > Number(t.integratedLufsMax)) {
    results.push(result(
      'warn',
      'loudness_integrated',
      `全体音量が目標範囲外です（${loudness.integratedLufs.toFixed(1)} LUFS / 期待 ${t.integratedLufsMin}〜${t.integratedLufsMax} LUFS）。`,
    ));
  }

  if (loudness.truePeak === null) {
    results.push(result('info', 'loudness_true_peak_skip', 'True Peak を取得できませんでした。'));
  } else if (loudness.truePeak > Number(t.truePeakMax)) {
    results.push(result('warn', 'loudness_true_peak', `True Peak が高すぎます（${loudness.truePeak.toFixed(1)} dBTP / 上限 ${t.truePeakMax} dBTP）。`));
  }

  results.push(...checkSegmentLoudness({ samples: loudness.samples, manifest, threshold: Number(t.segmentLufsRange) }));
  results.push(...checkSilence({ silence, manifest, minDuration: Number(t.silenceMinDuration) }));
  return results;
}

export function parseEbur128(log) {
  const samples = [];
  let section = null;
  let integratedLufs = null;
  let truePeak = null;
  for (const line of String(log || '').split(/\r?\n/)) {
    const sample = line.match(/\bt:\s*([0-9.]+)\s+.*?\bM:\s*(-?(?:[0-9.]+|inf)).*?\bI:\s*(-?(?:[0-9.]+|inf))\s+LUFS/u);
    if (sample) {
      samples.push({
        t: Number(sample[1]),
        m: parseLevel(sample[2]),
        i: parseLevel(sample[3]),
      });
    }
    if (line.includes('Integrated loudness:')) {
      section = 'integrated';
      continue;
    }
    if (line.includes('True peak:')) {
      section = 'truePeak';
      continue;
    }
    if (section === 'integrated') {
      const match = line.match(/\bI:\s*(-?(?:[0-9.]+|inf))\s+LUFS/u);
      if (match) {
        integratedLufs = parseLevel(match[1]);
        section = null;
      }
    } else if (section === 'truePeak') {
      const match = line.match(/\bPeak:\s*(-?(?:[0-9.]+|inf))\s+dB/u);
      if (match) {
        truePeak = parseLevel(match[1]);
        section = null;
      }
    }
  }
  return { integratedLufs, truePeak, samples };
}

export function parseSilenceDetect(log) {
  const intervals = [];
  let start = null;
  for (const line of String(log || '').split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/u);
    if (startMatch) {
      start = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/u);
    if (endMatch) {
      intervals.push({
        start: start ?? Math.max(0, Number(endMatch[1]) - Number(endMatch[2])),
        end: Number(endMatch[1]),
        duration: Number(endMatch[2]),
      });
      start = null;
    }
  }
  return intervals;
}

function checkSegmentLoudness({ samples, manifest, threshold }) {
  if (!manifest) {
    return [result('info', 'loudness_segment_skip', 'manifest が無いためクリップ間音量差の検査をスキップします。')];
  }
  if (!samples || samples.length === 0) {
    return [result('info', 'loudness_segment_samples_skip', 'ebur128 の時系列が無いためクリップ間音量差の検査をスキップします。')];
  }
  const segmentLevels = (manifest.segments || [])
    .filter((segment) => segment.kind === 'clip')
    .map((segment) => {
      const start = Number(segment.atSec);
      const end = start + Number(segment.durationSec);
      const values = samples
        .filter((sample) => sample.t >= start && sample.t <= end && Number.isFinite(sample.m) && sample.m > -99)
        .map((sample) => sample.m);
      return { segment, lufs: gatedLoudness(values) };
    })
    .filter((entry) => Number.isFinite(entry.lufs));
  if (segmentLevels.length < 2) {
    return [result('info', 'loudness_segment_insufficient', '比較できるクリップ音量が 2 件未満です。')];
  }
  const levels = segmentLevels.map((entry) => entry.lufs);
  const range = Math.max(...levels) - Math.min(...levels);
  if (range > threshold) {
    return [result('warn', 'loudness_segment_range', `クリップ間の音量差が大きすぎます（${range.toFixed(1)} LU / 上限 ${threshold} LU）。`)];
  }
  return [];
}

function checkSilence({ silence, manifest, minDuration }) {
  const intervals = silence.filter((entry) => entry.duration >= minDuration);
  if (intervals.length === 0) {
    return [];
  }
  if (!manifest) {
    return intervals.map((entry) => result(
      'warn',
      'silence_detected',
      `0.8 秒以上の無音を検出しました（${entry.start.toFixed(2)}s〜${entry.end.toFixed(2)}s）。`,
    ));
  }
  const clipSegments = (manifest.segments || []).filter((segment) => segment.kind === 'clip');
  const results = [];
  for (const entry of intervals) {
    const hit = clipSegments.find((segment) => overlapSec(entry, segment) >= minDuration);
    if (hit) {
      results.push(result(
        'warn',
        'silence_in_clip',
        `${hit.base} の区間内に ${entry.duration.toFixed(2)} 秒の無音があります。`,
        `${entry.start.toFixed(2)}s〜${entry.end.toFixed(2)}s`,
      ));
    }
  }
  return results;
}

function overlapSec(interval, segment) {
  const start = Math.max(interval.start, Number(segment.atSec));
  const end = Math.min(interval.end, Number(segment.atSec) + Number(segment.durationSec));
  return Math.max(0, end - start);
}

function parseLevel(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -120;
}

// momentary 値を dB のまま平均すると、クリップ内の間や小声に引っ張られて実際より低く出る
// （実測 -23.3/-23.0/-26.8 LUFS = 差 3.8 LU のクリップ 3 本が、単純平均では差 13.0 LU に化けた）。
// BS.1770 に倣い、エネルギー領域で平均し、絶対ゲート -70 LUFS と相対ゲート -10 LU をかける。
export function gatedLoudness(values) {
  const audible = values.filter((value) => value > -70);
  if (audible.length === 0) {
    return NaN;
  }
  const ungated = energyMean(audible);
  if (!Number.isFinite(ungated)) {
    return NaN;
  }
  const gated = audible.filter((value) => value >= ungated - 10);
  return gated.length > 0 ? energyMean(gated) : ungated;
}

function energyMean(values) {
  if (values.length === 0) {
    return NaN;
  }
  const sum = values.reduce((acc, value) => acc + 10 ** (value / 10), 0);
  return 10 * Math.log10(sum / values.length);
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/).find(Boolean) || '詳細なし';
}

function result(level, code, message, detail = null) {
  return { level, code, message, ...(detail ? { detail } : {}) };
}
