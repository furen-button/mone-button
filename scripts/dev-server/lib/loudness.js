// クリップ mp4 の音量を、取り込み（download.js の ffmpeg-normalize 既定 = EBU R128 -23 LUFS / true peak -2 dBTP）と
// 同じ基準へ揃えるための計測とゲイン計算。波形トリム・切り出しは 30 秒窓で揃えた mp4 を切り直すだけなので、
// 切った区間を測り直して volume で上げ下げする（ffmpeg-normalize の linear 相当）。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const LOUDNESS_TARGET_LUFS = -23;
export const TRUE_PEAK_LIMIT_DBTP = -2;
// ebur128 はゲートを通るブロックが無い（無音・0.4 秒未満）と -70 LUFS を返す。測れないものとして触らない。
const UNMEASURABLE_LUFS = -70;
// これより小さいゲインは掛けない（volume フィルタを足さない）。
const MIN_GAIN_DB = 0.05;

function parseLevel(text, label) {
  const match = text.match(new RegExp(`${label}:\\s+(-?[\\d.]+|-inf)`));
  if (!match || match[1] === '-inf') {
    return null;
  }
  return Number(match[1]);
}

// ebur128 の Summary から integrated loudness（LUFS）と true peak（dBTP）を取り出す。取れない値は null。
export function parseEbur128Summary(stderr) {
  const index = stderr.lastIndexOf('Summary:');
  if (index < 0) {
    return { integrated: null, truePeak: null };
  }
  const summary = stderr.slice(index);
  return {
    integrated: parseLevel(summary, 'I'),
    truePeak: parseLevel(summary.slice(summary.indexOf('True peak:')), 'Peak'),
  };
}

// 目標へ揃えるゲイン（dB）。上げるときは true peak が上限を超えない所で止める（下げるのは常に目標まで）。
// reason は target（目標どおり）/ peak（true peak で頭打ち）/ unmeasurable（測れないので 0）。
export function loudnessGain({ integrated, truePeak }) {
  if (!Number.isFinite(integrated) || integrated <= UNMEASURABLE_LUFS) {
    return { gainDb: 0, reason: 'unmeasurable' };
  }
  const wanted = LOUDNESS_TARGET_LUFS - integrated;
  if (wanted <= 0 || !Number.isFinite(truePeak)) {
    return { gainDb: round(wanted), reason: 'target' };
  }
  const headroom = Math.max(0, TRUE_PEAK_LIMIT_DBTP - truePeak);
  if (wanted > headroom) {
    return { gainDb: round(headroom), reason: 'peak' };
  }
  return { gainDb: round(wanted), reason: 'target' };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// ゲインを掛ける volume フィルタ。掛けるまでもないときは null。
export function volumeFilter(gainDb) {
  return Math.abs(gainDb) < MIN_GAIN_DB ? null : `volume=${gainDb.toFixed(2)}dB`;
}

// input の音声を ebur128 で測る。start / end（秒）を渡すとその区間だけ。
// 出力側の -ss / -to は -af の後ろで切るので区間が測れない。atrim で -af の先頭で切る。
export async function measureLoudness({ ffmpeg, input, start, end }) {
  const filters = [];
  if (start !== undefined || end !== undefined) {
    const range = [];
    if (start !== undefined) {
      range.push(`start=${start.toFixed(6)}`);
    }
    if (end !== undefined) {
      range.push(`end=${end.toFixed(6)}`);
    }
    filters.push(`atrim=${range.join(':')}`);
  }
  filters.push('ebur128=peak=true:framelog=verbose');
  const { stderr } = await execFileAsync(
    ffmpeg,
    ['-hide_banner', '-nostats', '-i', input, '-map', '0:a:0', '-af', filters.join(','), '-f', 'null', '-'],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return parseEbur128Summary(stderr);
}
