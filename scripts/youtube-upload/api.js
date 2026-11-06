import fs from 'node:fs';
import { createRecord, recordErrors, writeRecord } from './record.js';

const NO_RETRY = { retry: false };
const FAILURE_HISTORY = 10;

export async function getChannel(client) {
  const { data } = await client.channels.list({ part: ['snippet'], mine: true }, NO_RETRY);
  if (data.items?.length !== 1 || !data.items[0].id) {
    throw new Error('認可されたチャンネルを一意に確認できません。');
  }
  return { id: data.items[0].id, title: data.items[0].snippet?.title || '' };
}

// Google の例外はリクエスト本文や認証ヘッダーを含み得るため、そのまま出力しない。
// 応答本文の reason と文言、通信エラーのコードだけを取り出す。
export function failureDetail(error) {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const body = isPlainObject(data) ? data.error : undefined;
  let reasons = [];
  let message;
  if (typeof body === 'string') {
    // OAuth の token 更新の失敗は { error: 'invalid_grant', error_description } で返る。
    reasons = [body];
    message = data.error_description;
  } else if (isPlainObject(body)) {
    reasons = Array.isArray(body.errors) ? body.errors.map((item) => item?.reason) : [];
    message = body.message;
  }
  return {
    status: Number.isInteger(status) ? status : null,
    reasons: [...new Set(reasons.filter((reason) => typeof reason === 'string' && /^[\w.-]{1,64}$/u.test(reason)))],
    message: typeof message === 'string' && message.trim() ? message.replace(/\s+/gu, ' ').trim().slice(0, 300) : null,
    code: typeof error?.code === 'string' && /^E[A-Z0-9_]{1,40}$/u.test(error.code) ? error.code : null,
  };
}

export function apiFailure(stage, error) {
  const detail = { stage, ...failureDetail(error) };
  const labels = [detail.status === null ? null : `HTTP ${detail.status}`, ...detail.reasons, detail.code].filter(Boolean);
  const response = detail.message ? `応答: 「${detail.message}」。` : '';
  const failure = new Error(`${stage} に失敗しました${labels.length > 0 ? `（${labels.join(' / ')}）` : ''}。${response}upload.json と Studio を確認してください。`);
  failure.detail = detail;
  return failure;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function uploadPlan(plan, { client, channelId, retryVideo = false, noThumbnail = false, noComment = false }) {
  const errors = [...plan.errors, ...recordErrors(plan.record, plan.sha256, { retryVideo })];
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  if (!channelId) {
    throw new Error('YOUTUBE_CHANNEL_ID が必要です。先に --login を実行してください。');
  }
  if (plan.record && plan.record.channelId !== channelId) {
    throw new Error('upload.json のチャンネルと設定が違います。');
  }
  let channel;
  try {
    channel = await getChannel(client);
  } catch (error) {
    throw apiFailure('チャンネル確認', error);
  }
  if (channel.id !== channelId) {
    throw new Error('認可されたチャンネルと YOUTUBE_CHANNEL_ID が違います。送信しません。');
  }
  const record = plan.record ? structuredClone(plan.record) : createRecord(plan, channel.id);
  const save = () => writeRecord(plan.videoPath, record);
  // 失敗の理由は送り直しが成功した後も調べられるよう、直近の履歴として残す。
  const fail = (stage, error) => {
    const failure = apiFailure(stage, error);
    const history = Array.isArray(record.failures) ? record.failures : [];
    record.failures = [...history, { ...failure.detail, at: new Date().toISOString() }].slice(-FAILURE_HISTORY);
    try {
      save();
    } catch {
      // 記録が書けなくても、API の失敗のほうを伝える。
    }
    return failure;
  };
  if (record.steps.video !== 'done') {
    // 送信中の終了でも不確実な結果を自動再送しないよう、通信前に failed を残す。
    record.steps.video = 'failed';
    save();
    const body = fs.createReadStream(plan.videoPath);
    try {
      const { data } = await client.videos.insert({
        part: ['snippet', 'status'], requestBody: plan.requestBody,
        media: { mimeType: 'video/mp4', body },
      }, NO_RETRY);
      if (!data.id) {
        throw new Error('動画 ID がありません。');
      }
      record.videoId = data.id;
      record.url = `https://youtu.be/${data.id}`;
      record.uploadedAt = new Date().toISOString();
      record.steps.video = 'done';
      save();
    } catch (error) {
      throw fail('動画送信（自動再送なし）', error);
    } finally {
      body.destroy();
    }
  }
  if (record.steps.thumbnail === 'pending') {
    if (noThumbnail || !plan.thumbnail) {
      record.steps.thumbnail = 'skipped';
    } else {
      const body = fs.createReadStream(plan.thumbnail.path);
      try {
        await client.thumbnails.set({ videoId: record.videoId,
          media: { mimeType: plan.thumbnail.mimeType, body } }, NO_RETRY);
        record.steps.thumbnail = 'done';
      } catch (error) {
        throw fail('サムネイル送信', error);
      } finally {
        body.destroy();
      }
    }
    save();
  }
  if (record.steps.comment === 'pending') {
    if (noComment || plan.comments.length === 0) {
      record.steps.comment = 'skipped';
      save();
    } else {
      for (let i = record.commentIds.length; i < plan.comments.length; i++) {
        try {
          if (i === 0) {
            const { data } = await client.commentThreads.insert({ part: ['snippet'], requestBody: {
              snippet: { videoId: record.videoId, topLevelComment: { snippet: { textOriginal: plan.comments[i] } } },
            } }, NO_RETRY);
            const id = data.snippet?.topLevelComment?.id;
            if (!id) {
              throw new Error('コメント ID がありません。');
            }
            record.commentIds.push(id);
          } else {
            const { data } = await client.comments.insert({ part: ['snippet'], requestBody: {
              snippet: { parentId: record.commentIds[0], textOriginal: plan.comments[i] },
            } }, NO_RETRY);
            if (!data.id) {
              throw new Error('返信 ID がありません。');
            }
            record.commentIds.push(data.id);
          }
        } catch (error) {
          throw fail('コメント送信', error);
        }
        // 返信の途中で失敗しても投稿済みのコメントは繰り返さない。
        save();
      }
      record.steps.comment = 'done';
      save();
    }
  }
  return record;
}
