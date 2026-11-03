import fs from 'node:fs';
import path from 'node:path';

export function recordPathFor(videoPath) {
  return videoPath.replace(/\.mp4$/iu, '') + '.upload.json';
}

export function readRecord(videoPath) {
  try {
    const record = JSON.parse(fs.readFileSync(recordPathFor(videoPath), 'utf8'));
    if (record.version !== 1 || !/^[a-f0-9]{64}$/u.test(record.sha256)
      || !record.channelId || record.privacyStatus !== 'private'
      || !['done', 'failed', 'pending'].includes(record.steps?.video)
      || !['done', 'skipped', 'pending'].includes(record.steps?.thumbnail)
      || !['done', 'skipped', 'pending'].includes(record.steps?.comment)
      || !Array.isArray(record.commentIds) || record.commentIds.some((id) => typeof id !== 'string' || !id)
      || (record.steps.video === 'done' && !record.videoId)
      || (record.steps.video !== 'done' && record.videoId)) {
      throw new Error('形式が不正です');
    }
    return record;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw new Error(`upload.json を読めません: ${error.message}`);
  }
}

export function recordErrors(record, sha256, { retryVideo = false } = {}) {
  if (!record) {
    return [];
  }
  const errors = [];
  if (record.sha256 !== sha256) {
    errors.push('mp4 の SHA-256 が upload.json と違います。Studio で古い動画を削除してから記録を削除してください。');
  }
  if (record.steps.video === 'failed' && !retryVideo) {
    errors.push('動画送信が失敗済みです。Studio を確認し、動画が無い場合だけ --retry-video を指定してください。');
  }
  if (record.steps.video === 'done' && ['done', 'skipped'].includes(record.steps.thumbnail)
    && ['done', 'skipped'].includes(record.steps.comment)) {
    errors.push('この mp4 はアップロード済みです。');
  }
  return errors;
}

export function createRecord(plan, channelId) {
  return {
    version: 1, video: path.basename(plan.videoPath), sha256: plan.sha256, channelId,
    videoId: null, url: null, privacyStatus: 'private', uploadedAt: null,
    title: plan.requestBody.snippet.title, qcErrorAllowed: plan.qcErrorAllowed === true,
    steps: { video: 'pending', thumbnail: 'pending', comment: 'pending' }, commentIds: [],
  };
}

// 各 API の成功直後に置き換える。書き込み失敗時は次の段へ進まない。
export function writeRecord(videoPath, record) {
  const file = recordPathFor(videoPath);
  const temp = `${file}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
