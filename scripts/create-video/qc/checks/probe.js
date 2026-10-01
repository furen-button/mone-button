import fs from 'fs';
import { execFileSync } from 'child_process';
import { outputSize } from '../../config.js';
import { audioPtsHoleMs } from '../../assets.js';
import { summaryPathsFor } from '../../summary.js';

export function runProbeChecks({ tools, videoPath, manifest, config }) {
  const probe = probeMedia(tools.ffprobe, videoPath);
  const results = [
    ...checkSignature({ probe, manifest, config }),
    ...checkAvDurationGap({ probe, config }),
    ...checkAudioPtsHole({ tools, videoPath, config }),
    ...checkTotalDuration({ probe, manifest, config }),
    ...checkConcatMethod({ manifest }),
    ...checkChapterTimes({ videoPath, manifest, config }),
    ...checkFaceAvoidance({ manifest }),
    ...checkEnhance({ manifest }),
  ];
  return { probe, results };
}

// 補正（effects.enhance）を設定したのに libplacebo 不可やシェーダ欠落で素通しになったクリップは、意図した画質でないので知らせる。
function checkEnhance({ manifest }) {
  if (!manifest) {
    return [];
  }
  const results = [];
  for (const segment of manifest.segments || []) {
    const enhance = segment.enhance;
    if (segment.kind !== 'clip' || !enhance?.fallback) {
      continue;
    }
    results.push(result(
      'warn',
      'enhance_fallback',
      `${segment.base} は補正（Anime4K）をスキップして元の画質のまま描画しました。`,
      enhance.reason || null,
    ));
  }
  return results;
}

// 顔回避が「幅不足」で見送られたクリップは、セリフボックスが顔に掛かったままなので知らせる。
function checkFaceAvoidance({ manifest }) {
  if (!manifest) {
    return [];
  }
  const results = [];
  for (const segment of manifest.segments || []) {
    const avoid = segment.avoidFace;
    if (segment.kind !== 'clip' || !avoid?.fallback) {
      continue;
    }
    results.push(result(
      'warn',
      'serif_face_fallback',
      `${segment.base} はセリフボックスが顔に重なりますが、避けると幅が足りないため全幅のままです。`,
      avoid.reason || null,
    ));
  }
  return results;
}

export function probeMedia(ffprobe, videoPath) {
  const raw = execFileSync(ffprobe, [
    '-v', 'error',
    '-show_entries',
    'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,start_time,duration,sample_rate,channels,channel_layout',
    '-of', 'json',
    videoPath,
  ], { encoding: 'utf8' });
  return JSON.parse(raw);
}

function checkSignature({ probe, manifest, config }) {
  const results = [];
  const video = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (probe.streams || []).find((stream) => stream.codec_type === 'audio');
  const expectedSize = manifest?.signature || outputSize(config);
  const expected = {
    width: Number(expectedSize.width),
    height: Number(expectedSize.height),
    fps: Number(expectedSize.fps),
    pixFmt: config.qc.signature.pixFmt,
    sampleRate: Number(config.qc.signature.sampleRate),
    channels: Number(config.qc.signature.channels),
  };

  if (!video) {
    results.push(result('error', 'probe_video_missing', '映像ストリームがありません。'));
  } else {
    if (Number(video.width) !== expected.width || Number(video.height) !== expected.height) {
      results.push(result('error', 'probe_resolution', `解像度が期待値と違います（${video.width}x${video.height} / 期待 ${expected.width}x${expected.height}）。`));
    }
    const fps = rateToNumber(video.r_frame_rate || video.avg_frame_rate);
    if (!nearlyEqual(fps, expected.fps, 0.01)) {
      results.push(result('error', 'probe_fps', `fps が期待値と違います（${fps.toFixed(3)} / 期待 ${expected.fps}）。`));
    }
    if (video.pix_fmt !== expected.pixFmt) {
      results.push(result('error', 'probe_pix_fmt', `pix_fmt が ${expected.pixFmt} ではありません（${video.pix_fmt}）。`));
    }
  }

  if (!audio) {
    results.push(result('error', 'probe_audio_missing', '音声ストリームがありません。'));
  } else {
    if (Number(audio.sample_rate) !== expected.sampleRate) {
      results.push(result('error', 'probe_sample_rate', `音声サンプルレートが期待値と違います（${audio.sample_rate}Hz / 期待 ${expected.sampleRate}Hz）。`));
    }
    if (Number(audio.channels) !== expected.channels) {
      results.push(result('error', 'probe_channels', `音声チャンネル数が期待値と違います（${audio.channels} / 期待 ${expected.channels}）。`));
    }
  }

  return results;
}

// 音声ストリームと映像ストリームの尺差。連結でセグメントごとに音ズレが積み上がると
// ここに合計として現れる。相互相関（python 依存）が使えない環境でも必ず効く軽い門番。
export function checkAvDurationGap({ probe, config }) {
  const video = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (probe.streams || []).find((stream) => stream.codec_type === 'audio');
  const videoSec = Number(video?.duration);
  const audioSec = Number(audio?.duration);
  if (!Number.isFinite(videoSec) || !Number.isFinite(audioSec)) {
    return [result('info', 'probe_av_gap_skip', 'ストリーム尺を取得できないため A/V 尺差の検査をスキップします。')];
  }
  const gapMs = (audioSec - videoSec) * 1000;
  const thresholdMs = Number(config.qc.thresholds.avGapMs);
  if (Math.abs(gapMs) > thresholdMs) {
    return [result(
      'error',
      'probe_av_duration_gap',
      `音声と映像の尺が ${Math.round(gapMs)}ms ずれています。`,
      `音声 ${audioSec.toFixed(3)}s / 映像 ${videoSec.toFixed(3)}s / 許容 ±${thresholdMs}ms`,
    )];
  }
  return [];
}

// 音声パケットの pts の穴。ソース（yt-dlp 区間切り出しの 96kHz 音声）由来の穴が
// async 無しで通ると、AAC パケット 1 個の duration が数十 ms 伸びた形で残り、プレイヤーは
// pts を尊重するので穴以降の音声が遅れる。連結でクリップごとに積み上がる累積音ズレの正体。
export function checkAudioPtsHole({ tools, videoPath, config }) {
  const holeMs = audioPtsHoleMs({ ffprobe: tools.ffprobe, filePath: videoPath });
  if (holeMs === null) {
    return [result('info', 'probe_audio_hole_skip', '音声パケットを読めないため pts の穴の検査をスキップします。')];
  }
  const thresholdMs = Number(config.qc.thresholds.audioHoleMs);
  if (holeMs > thresholdMs) {
    return [result(
      'error',
      'probe_audio_pts_hole',
      `音声の pts に合計 ${Math.round(holeMs)}ms の穴があります（穴以降の音声が遅れます）。`,
      `許容 ${thresholdMs}ms。ソースの穴は npm run fixCacheAudio で埋められます`,
    )];
  }
  return [];
}

function checkTotalDuration({ probe, manifest, config }) {
  if (!manifest) {
    return [result('info', 'probe_duration_skip', 'manifest が無いため総尺の期待値比較をスキップします。')];
  }
  const video = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const actual = Number(video?.duration) || Number(probe.format?.duration) || 0;
  const expected = (manifest.segments || []).reduce((sum, segment) => sum + Number(segment.durationSec || 0), 0);
  const fps = Number(manifest.signature?.fps || outputSize(config).fps || 30);
  const threshold = Number(config.qc.thresholds.durationFrames) / fps;
  const diff = Math.abs(actual - expected);
  if (diff > threshold) {
    return [result(
      'error',
      'probe_total_duration',
      `映像総尺が manifest と一致しません（実測 ${actual.toFixed(3)}s / 期待 ${expected.toFixed(3)}s）。`,
      `差分 ${diff.toFixed(3)}s / 許容 ${threshold.toFixed(3)}s / format=${Number(probe.format?.duration || 0).toFixed(3)}s`,
    )];
  }
  return [];
}

function checkConcatMethod({ manifest }) {
  if (!manifest) {
    return [result('info', 'probe_concat_skip', 'manifest が無いため concat 経路の検査をスキップします。')];
  }
  if (manifest.concatMethod !== 'concat-vcopy') {
    return [result('warn', 'probe_concat_method', `concat 経路が concat-vcopy ではありません（${manifest.concatMethod}）。`)];
  }
  return [];
}

function checkChapterTimes({ videoPath, manifest, config }) {
  if (!manifest) {
    return [result('info', 'probe_chapters_skip', 'manifest が無いため概要欄時刻の検査をスキップします。')];
  }
  const metaPath = summaryPathsFor(videoPath).meta;
  if (!fs.existsSync(metaPath)) {
    return [result('info', 'probe_chapters_missing', 'meta.json が無いため概要欄時刻の検査をスキップします。')];
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const chapters = Array.isArray(meta.chapters) ? meta.chapters : [];
  if (chapters.length === 0) {
    return [result('info', 'probe_chapters_empty', 'meta.json にチャプターが無いため概要欄時刻の検査をスキップします。')];
  }
  const expected = expectedChapterStarts(manifest);
  const threshold = Number(config.qc.thresholds.chapterDriftSec);
  const results = [];
  for (let i = 0; i < Math.min(chapters.length, expected.length); i++) {
    const actualSec = Number(chapters[i].sec);
    const expectedSec = expected[i];
    const diff = Math.abs(actualSec - expectedSec);
    if (diff > threshold) {
      results.push(result(
        'warn',
        'probe_chapter_time',
        `チャプター ${i + 1} の時刻が実測境界とずれています（${actualSec}s / 期待 ${expectedSec}s）。`,
        `差分 ${diff.toFixed(3)}s / 許容 ${threshold}s`,
      ));
    }
  }
  if (chapters.length !== expected.length) {
    results.push(result('warn', 'probe_chapter_count', `meta.json のチャプター数 ${chapters.length} と manifest 境界数 ${expected.length} が違います。`));
  }
  return results;
}

function expectedChapterStarts(manifest) {
  const starts = [];
  let previous = null;
  for (const segment of manifest.segments || []) {
    if (!segment.videoId) {
      continue;
    }
    if (segment.videoId === previous) {
      continue;
    }
    starts.push(starts.length === 0 ? 0 : Math.round(Number(segment.atSec) || 0));
    previous = segment.videoId;
  }
  return starts;
}

export function rateToNumber(value) {
  const text = String(value || '');
  if (text.includes('/')) {
    const [num, den] = text.split('/').map(Number);
    return den ? num / den : 0;
  }
  return Number(text) || 0;
}

function nearlyEqual(a, b, epsilon) {
  return Math.abs(a - b) <= epsilon;
}

function result(level, code, message, detail = null) {
  return { level, code, message, ...(detail ? { detail } : {}) };
}
