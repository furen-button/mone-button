import { shiftCamera } from '../../create-video/camera.js';
import { normalizeReview } from './clip-review.js';

const CLIP_BASE_PATTERN = /^[\w-]+$/u;
const MIN_TRIM_SECONDS = 0.3;
const NOOP_EPSILON_SECONDS = 0.01;
// 1 回で広げられる上限。取り直しは区間の長さに比例して時間が掛かる。
const MAX_EXTEND_SECONDS = 60;

export class TrimValidationError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'TrimValidationError';
    this.status = status;
  }
}

export function createTrimPlan(payload, current, sourceDuration) {
  const { fileBaseName, keepStart, keepEnd } = parseTrimPayload(payload);
  assertSourceDuration(sourceDuration);
  assertTrimRange({ keepStart, keepEnd, sourceDuration });

  if (isNoopTrim({ keepStart, keepEnd, sourceDuration })) {
    return {
      fileBaseName,
      keepStart,
      keepEnd,
      noop: true,
      updated: current,
    };
  }

  return {
    fileBaseName,
    keepStart,
    keepEnd,
    noop: false,
    updated: createRangeData(current, keepStart, keepEnd),
  };
}

export function createExcerptPlan(payload, current, sourceDuration) {
  const { fileBaseName, keepStart, keepEnd } = parseTrimPayload(payload);
  assertSourceDuration(sourceDuration);
  assertTrimRange({ keepStart, keepEnd, sourceDuration });

  const created = createRangeData(current, keepStart, keepEnd);
  if (typeof current.videoId !== 'string' || !CLIP_BASE_PATTERN.test(current.videoId)) {
    throw new TrimValidationError(400, 'videoId が不正です');
  }
  let date = /^(\d{4}-\d{2}-\d{2})-/u.exec(fileBaseName)?.[1];
  if (!date) {
    const uploadDate = current.videoFile?.metadata?.uploadDate;
    if (typeof uploadDate === 'string' && /^\d{8}$/u.test(uploadDate)) {
      date = `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
    }
  }
  if (!date) {
    throw new TrimValidationError(400, 'ファイル名または uploadDate に日付が必要です');
  }
  const pad6 = (seconds) => String(Math.floor(seconds)).padStart(6, '0');
  const targetBaseName = `${date}-${current.videoId}-${pad6(created.trimming.startTime)}-${pad6(created.trimming.endTime)}`;
  if (targetBaseName === fileBaseName) {
    throw new TrimValidationError(409, '元のクリップと同じファイル名になります。別の範囲を選択してください。');
  }
  return { fileBaseName, targetBaseName, keepStart, keepEnd, created };
}

// 先頭を extendStart 秒・末尾を extendEnd 秒広げた範囲を求める。配信の先頭（0 秒）と
// メタデータの尺を超える分は切り詰め、どちらにも広がらなければ 400。
// 手元の mp4 は切った範囲しか持たないので、呼び出し側で新しい範囲を YouTube から取り直す。
export function createExtendPlan(payload, current) {
  const { fileBaseName, extendStart, extendEnd } = parseExtendPayload(payload);
  if (typeof current.videoId !== 'string' || !CLIP_BASE_PATTERN.test(current.videoId)) {
    throw new TrimValidationError(400, 'videoId が不正です');
  }
  const trimming = readTrimming(current);
  const sourceDuration = current.videoFile?.metadata?.duration;
  const startTime = Math.max(0, trimming.startTime - extendStart);
  const endTime = Number.isFinite(sourceDuration) && sourceDuration > 0
    ? Math.min(sourceDuration, trimming.endTime + extendEnd)
    : trimming.endTime + extendEnd;
  const addedStart = trimming.startTime - startTime;
  const addedEnd = endTime - trimming.endTime;
  if (addedStart < NOOP_EPSILON_SECONDS && addedEnd < NOOP_EPSILON_SECONDS) {
    throw new TrimValidationError(400, 'これ以上広げられません（配信の先頭または末尾です）');
  }

  const updated = createRangeData(current, -addedStart, trimming.endTime - trimming.startTime + addedEnd);
  return { fileBaseName, videoId: current.videoId, addedStart, addedEnd, updated };
}

export function parseExtendPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new TrimValidationError(400, 'payload must be an object');
  }

  const { fileBaseName, extendStart, extendEnd } = payload;
  if (typeof fileBaseName !== 'string' || !CLIP_BASE_PATTERN.test(fileBaseName)) {
    throw new TrimValidationError(400, 'invalid fileBaseName');
  }
  const isValidAmount = (value) => Number.isFinite(value) && value >= 0 && value <= MAX_EXTEND_SECONDS;
  if (!isValidAmount(extendStart) || !isValidAmount(extendEnd)) {
    throw new TrimValidationError(400, `extendStart and extendEnd must be between 0 and ${MAX_EXTEND_SECONDS} seconds`);
  }
  if (extendStart === 0 && extendEnd === 0) {
    throw new TrimValidationError(400, 'extendStart or extendEnd must be positive');
  }

  return { fileBaseName, extendStart, extendEnd };
}

function createRangeData(current, keepStart, keepEnd) {
  const trimming = readTrimming(current);
  const nextStartTime = trimming.startTime + keepStart;
  const nextEndTime = trimming.startTime + keepEnd;
  const nextDuration = keepEnd - keepStart;
  const nextTrimming = {
    ...trimming,
    startTime: nextStartTime,
    endTime: nextEndTime,
    duration: nextDuration,
  };

  if (!Object.hasOwn(nextTrimming, 'original')) {
    nextTrimming.original = {
      startTime: trimming.startTime,
      endTime: trimming.endTime,
      duration: trimming.duration,
    };
  }

  const next = {
    ...current,
    clipUrl: rewriteClipUrl(current.clipUrl, nextStartTime),
    trimming: nextTrimming,
  };
  if (current.effects?.camera) {
    next.effects = { ...current.effects, camera: Object.fromEntries(Object.entries(current.effects.camera)
      .map(([aspect, frames]) => [aspect, shiftCamera(frames, keepStart, nextDuration)])) };
  }
  // 切ったあとは「未カットのままで良い」の確認（review.trim）は意味を失うので落とす。
  // ruby / serif の確認は値が変わらないので残る。
  const review = normalizeReview(current.review, next);
  if (review) {
    next.review = review;
  } else {
    delete next.review;
  }
  return next;
}

export function parseTrimPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new TrimValidationError(400, 'payload must be an object');
  }

  const { fileBaseName, keepStart, keepEnd } = payload;
  if (typeof fileBaseName !== 'string' || !CLIP_BASE_PATTERN.test(fileBaseName)) {
    throw new TrimValidationError(400, 'invalid fileBaseName');
  }
  if (!Number.isFinite(keepStart) || !Number.isFinite(keepEnd)) {
    throw new TrimValidationError(400, 'keepStart and keepEnd must be finite numbers');
  }

  return { fileBaseName, keepStart, keepEnd };
}

function assertSourceDuration(sourceDuration) {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new TrimValidationError(400, 'source duration is invalid');
  }
}

function assertTrimRange({ keepStart, keepEnd, sourceDuration }) {
  if (keepStart < 0 || keepEnd <= keepStart || keepEnd > sourceDuration) {
    throw new TrimValidationError(400, 'trim range is outside source duration');
  }
  if (keepEnd - keepStart < MIN_TRIM_SECONDS) {
    throw new TrimValidationError(400, `trim duration must be at least ${MIN_TRIM_SECONDS} seconds`);
  }
}

function isNoopTrim({ keepStart, keepEnd, sourceDuration }) {
  return Math.abs(keepStart) < NOOP_EPSILON_SECONDS
    && Math.abs(sourceDuration - keepEnd) < NOOP_EPSILON_SECONDS;
}

function readTrimming(current) {
  if (!isPlainObject(current) || !isPlainObject(current.trimming)) {
    throw new TrimValidationError(400, 'trimming is missing');
  }

  const { startTime, endTime, duration } = current.trimming;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || !Number.isFinite(duration)) {
    throw new TrimValidationError(400, 'trimming values must be finite numbers');
  }

  return current.trimming;
}

function rewriteClipUrl(clipUrl, startTime) {
  const nextTime = `${Math.floor(startTime)}s`;
  if (typeof clipUrl !== 'string' || clipUrl.length === 0) {
    return clipUrl;
  }

  if (/[?&]t=/u.test(clipUrl)) {
    return clipUrl.replace(/([?&])t=[^&]*/u, `$1t=${nextTime}`);
  }

  const separator = clipUrl.includes('?') ? '&' : '?';
  return `${clipUrl}${separator}t=${nextTime}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
