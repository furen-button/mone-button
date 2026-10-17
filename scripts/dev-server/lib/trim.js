const CLIP_BASE_PATTERN = /^[\w-]+$/u;
const MIN_TRIM_SECONDS = 0.3;
const NOOP_EPSILON_SECONDS = 0.01;

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

  return {
    ...current,
    clipUrl: rewriteClipUrl(current.clipUrl, nextStartTime),
    trimming: nextTrimming,
  };
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
