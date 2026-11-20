import fs from 'node:fs';
import path from 'node:path';
import { videoSidecar } from '../dev-server/lib/thumbnail-paths.js';
import { apiFailure, getChannel } from './api.js';

const NO_RETRY = { retry: false };
const PRIVACIES = ['unlisted', 'public', 'private'];

export function playlistRecordPath(videoPath) {
  return videoPath.replace(/\.mp4$/iu, '') + '.playlist.json';
}

export function readPlaylistRecord(videoPath) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(playlistRecordPath(videoPath), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw new Error('playlist.json を読めません。');
  }
  if (record?.version !== 1 || record.video !== path.basename(videoPath)
    || typeof record.channelId !== 'string' || !record.channelId
    || (record.playlistId !== null && (typeof record.playlistId !== 'string' || !record.playlistId))
    || !PRIVACIES.includes(record.privacyStatus) || typeof record.title !== 'string' || !record.title
    || !Array.isArray(record.items) || record.items.some((item) => !item || typeof item.videoId !== 'string'
      || !item.videoId || typeof item.playlistItemId !== 'string' || !item.playlistItemId)
    || !Array.isArray(record.failures)) {
    throw new Error('playlist.json の形式が不正です。');
  }
  return record;
}

export function writePlaylistRecord(videoPath, record) {
  const file = playlistRecordPath(videoPath);
  const temp = `${file}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function loadPlaylistPlan(videoPath, { projectRoot, playlistTitle, playlistPrivacy = 'unlisted' }) {
  videoPath = path.resolve(projectRoot, videoPath);
  if (!/\.mp4$/iu.test(videoPath) || !fs.statSync(videoPath).isFile()) {
    throw new Error('通常ファイルの mp4 を指定してください。');
  }
  const metaPath = videoSidecar({ projectRoot, outputDir: path.join(projectRoot, 'output') }, videoPath, 'meta.json');
  if (!metaPath) {
    throw new Error('meta.json がありません。');
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (!Array.isArray(meta?.sources) || meta.sources.length === 0) {
    throw new Error('meta.json の sources が無いか空です。');
  }
  if (meta.sources.some((source) => typeof source?.videoId !== 'string' || !source.videoId.trim())) {
    throw new Error('sources の videoId が不正です。');
  }
  const videoIds = [...new Set(meta.sources.map((source) => source.videoId))];
  const videoTitle = meta.upload?.title;
  if (playlistTitle === undefined && (typeof videoTitle !== 'string' || !videoTitle.trim())) {
    throw new Error('meta.upload.title が無いため --playlist-title が必要です。');
  }
  const title = playlistTitle ?? `【出典】${videoTitle}`;
  if (typeof title !== 'string' || !title.trim() || [...title].length > 150 || /[<>]/u.test(title)) {
    throw new Error('再生リストのタイトルは < > を含まない 1〜150 文字にしてください。');
  }
  if (!PRIVACIES.includes(playlistPrivacy)) {
    throw new Error('再生リストの公開範囲が不正です。');
  }
  const record = readPlaylistRecord(videoPath);
  // 再開では作成済みのタイトルと公開範囲を使う。既存リストの更新は行わない。
  return { videoPath, videoIds, record, title: record?.title ?? title,
    privacyStatus: record?.privacyStatus ?? playlistPrivacy,
    description: `「${typeof videoTitle === 'string' && videoTitle.trim() ? videoTitle : title}」で使った配信（初登場順）` };
}

export function playlistEstimate(plan) {
  const recorded = new Set(plan.record?.items.map((item) => item.videoId) ?? []);
  const pending = plan.videoIds.filter((id) => !recorded.has(id)).length;
  // 通信しないため、再開時のページ数は記録の件数から見積もる。
  const list = plan.record?.playlistId ? Math.max(1, Math.ceil(recorded.size / 50)) : 0;
  const creation = plan.record?.playlistId ? 0 : 50;
  return { recorded: recorded.size, pending, creation, list, units: creation + pending * 50 + list };
}

export async function createSourcePlaylist(plan, { client, channelId }) {
  if (!channelId) {
    throw new Error('YOUTUBE_CHANNEL_ID が必要です。先に --login を実行してください。');
  }
  if (plan.record && plan.record.channelId !== channelId) {
    throw new Error('playlist.json のチャンネルと設定が違います。');
  }
  const record = plan.record ? structuredClone(plan.record) : {
    version: 1, video: path.basename(plan.videoPath), channelId, playlistId: null, url: null,
    privacyStatus: plan.privacyStatus, title: plan.title, createdAt: null, items: [], failures: [],
  };
  const save = () => writePlaylistRecord(plan.videoPath, record);
  const call = async (stage, operation) => {
    try {
      return await operation();
    } catch (error) {
      const failure = apiFailure(stage, error, 'playlist.json');
      record.failures = [...record.failures, { ...failure.detail, at: new Date().toISOString() }].slice(-10);
      try {
        save();
      } catch {
        // 記録できなくても認証情報を含み得る例外は表示しない。
      }
      failure.message += '同じコマンドをもう一度実行すると続きから追加できます。';
      throw failure;
    }
  };
  const channel = await call('チャンネル確認', () => getChannel(client));
  if (channel.id !== channelId) {
    throw new Error('認可されたチャンネルと YOUTUBE_CHANNEL_ID が違います。送信しません。');
  }
  save();
  const existing = new Set(record.items.map((item) => item.videoId));
  if (record.playlistId) {
    let pageToken;
    do {
      const { data } = await call('再生リスト確認', () => client.playlistItems.list({
        part: ['snippet'], playlistId: record.playlistId, maxResults: 50, ...(pageToken ? { pageToken } : {}),
      }, NO_RETRY));
      for (const item of data.items ?? []) {
        const videoId = item.snippet?.resourceId?.videoId;
        if (videoId && item.id) {
          if (!existing.has(videoId)) {
            record.items.push({ videoId, playlistItemId: item.id });
          }
          existing.add(videoId);
        }
      }
      save();
      pageToken = data.nextPageToken;
    } while (pageToken);
  } else {
    const { data } = await call('再生リスト作成', async () => {
      const response = await client.playlists.insert({ part: ['snippet', 'status'], requestBody: {
        snippet: { title: plan.title, description: plan.description }, status: { privacyStatus: plan.privacyStatus },
      } }, NO_RETRY);
      if (!response.data.id) {
        throw new Error('再生リスト ID がありません。');
      }
      return response;
    });
    record.playlistId = data.id;
    record.url = `https://www.youtube.com/playlist?list=${data.id}`;
    record.createdAt = new Date().toISOString();
    save();
  }
  for (const videoId of plan.videoIds) {
    if (existing.has(videoId)) {
      continue;
    }
    const { data } = await call('出典の追加', async () => {
      const response = await client.playlistItems.insert({ part: ['snippet'], requestBody: { snippet: {
        playlistId: record.playlistId, resourceId: { kind: 'youtube#video', videoId },
      } } }, NO_RETRY);
      if (!response.data.id) {
        throw new Error('再生リスト項目 ID がありません。');
      }
      return response;
    });
    record.items.push({ videoId, playlistItemId: data.id });
    existing.add(videoId);
    save();
  }
  return record;
}

export async function runSourcePlaylists(videos, { root, options, loadEnvironment, clientForEnv }) {
  // 全候補を通信前に検査する。動画用の概要欄や QC はこのモードでは不要。
  const plans = videos.map((video) => loadPlaylistPlan(video, { projectRoot: root, ...options }));
  for (const plan of plans) {
    const estimate = playlistEstimate(plan);
    console.log(`動画: ${path.relative(root, plan.videoPath)}\n再生リスト: ${plan.title}\n公開範囲: ${plan.privacyStatus}`);
    console.log(`追加予定: ${estimate.pending} 本 / 記録済み: ${estimate.recorded} 本`);
    console.log(`見積もり: ${estimate.units} units（作成 ${estimate.creation} + 追加 ${estimate.pending} × 50 + list ${estimate.list}）。チャンネル確認は別途 1 unit。`);
    if (plan.record?.url) {
      console.log(plan.record.url);
    }
  }
  if (options.dryRun) {
    console.log('dry-run: 通信していません。再開時の list 件数と追加予定は記録からの概算です。');
    return;
  }
  const env = loadEnvironment(root);
  const client = clientForEnv(env);
  for (const plan of plans) {
    const current = loadPlaylistPlan(plan.videoPath, { projectRoot: root, ...options });
    const result = await createSourcePlaylist(current, { client, channelId: env.YOUTUBE_CHANNEL_ID });
    console.log(`出典の再生リスト: ${result.url}`);
  }
}
