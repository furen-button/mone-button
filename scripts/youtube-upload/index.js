#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { createApiClient, login } from './auth.js';
import { loadPlan } from './plan.js';
import { uploadPlan } from './api.js';

export const STUDIO_CHECKLIST = `Studio で手作業すること:
1. 公開前の最終確認: 二次創作ガイドライン、コラボ相手の条件、出典と非公式表記
2. コメントのピン留め
3. 終了画面の要素
4. 公開に切り替える`;

export function parseOptions(args) {
  const { values } = parseArgs({ args, options: {
    login: { type: 'boolean' }, video: { type: 'string', multiple: true },
    'dry-run': { type: 'boolean' }, title: { type: 'string' },
    'no-thumbnail': { type: 'boolean' }, 'no-comment': { type: 'boolean' }, 'retry-video': { type: 'boolean' },
    'allow-qc-error': { type: 'boolean' },
  } });
  if (values.login && Object.keys(values).some((key) => key !== 'login')) {
    throw new Error('--login は単独で指定してください。');
  }
  if (!values.login && !values.video?.length) {
    throw new Error('--video <mp4> または --login を指定してください。');
  }
  return { login: values.login, videos: values.video || [], dryRun: values['dry-run'], title: values.title,
    noThumbnail: values['no-thumbnail'], noComment: values['no-comment'], retryVideo: values['retry-video'],
    allowQcError: values['allow-qc-error'] };
}

export function expandVideos(patterns, root) {
  const files = [];
  for (const pattern of patterns) {
    const matches = /[*?\[\]{}]/u.test(pattern) ? fs.globSync(pattern, { cwd: root }).sort() : [pattern];
    if (matches.length === 0) {
      throw new Error(`動画が見つかりません: ${pattern}`);
    }
    files.push(...matches.map((file) => path.resolve(root, file)));
  }
  return [...new Set(files)];
}

export async function main(args = process.argv.slice(2), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  { loadEnvironment = loadEnv, clientForEnv = createApiClient } = {}) {
  const options = parseOptions(args);
  if (options.login) {
    await login({ root, env: loadEnvironment(root) });
    return;
  }
  const videos = expandVideos(options.videos, root);
  // 全候補を通信前に検査する。後ろの候補に error があっても先に送らない。
  const plans = [];
  let invalid = false;
  for (const videoPath of videos) {
    try {
      const plan = await loadPlan(videoPath, { projectRoot: root, ...options });
      plans.push(plan);
      console.log(`動画: ${path.relative(root, videoPath)}`);
      for (const warning of plan.warnings) {
        console.warn(`警告: ${warning}`);
      }
      for (const error of plan.errors) {
        console.error(`エラー: ${error}`);
      }
      invalid ||= plan.errors.length > 0;
      console.log(JSON.stringify({ ...plan.requestBody,
        thumbnail: plan.thumbnail ? path.relative(root, plan.thumbnail.path) : null,
        comments: plan.comments, resume: plan.record?.steps || null }, null, 2));
    } catch (error) {
      invalid = true;
      console.error(`エラー: ${path.relative(root, videoPath)}: ${error.message}`);
    }
  }
  if (invalid) {
    throw new Error('事前検査で error があるため、何も送信しません。');
  }
  if (options.dryRun) {
    console.log('dry-run: 送信していません。');
    console.log(STUDIO_CHECKLIST);
    return;
  }
  const env = loadEnvironment(root);
  const client = clientForEnv(env);
  for (const plan of plans) {
    // 先行動画の処理中に変更された入力や記録をそのまま使わない。
    const current = await loadPlan(plan.videoPath, { projectRoot: root, ...options });
    const result = await uploadPlan(current, { client, channelId: env.YOUTUBE_CHANNEL_ID, ...options });
    console.log(`非公開でアップロードしました: ${result.url}`);
  }
  console.log(STUDIO_CHECKLIST);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
