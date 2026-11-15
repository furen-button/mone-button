#!/usr/bin/env node
// 侍まとめと同じ見た目で、任意カテゴリの横（切り抜き風）と Shorts のプリセットを作る。
//
//   node .claude/skills/category-video/scripts/make-presets.mjs --category 異議あり --slug igiari
//
// - 横: scripts/create-video/config-samurai.json を元にする（侍まとめで公開した見た目）。
// - Shorts: scripts/create-video/config-shorts.json を元に、侍の Shorts と同じく
//   output.split.minSec を 20 にする（config-shorts-samurai.json は git 管理外のため元にしない）。
// - 書き換えるのはカテゴリ・出力名・概要欄の導入文とタグだけ。select.exclude は持ち込まない。
// - 出力名の日付は、選ばれるクリップのうち最も古い配信日（createVideo の --order date の先頭）。
// - 既存のプリセットは --force が無ければ上書きしない。

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const PRESET_DIR = path.join(ROOT, 'scripts/create-video');
const DATA_DIR = path.join(ROOT, 'public/data');
const SHORTS_MIN_SEC = 20;

function parseArgs(argv) {
  const args = { category: null, slug: null, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--category') {
      args.category = argv[++i];
    } else if (a === '--slug') {
      args.slug = argv[++i];
    } else if (a === '--force') {
      args.force = true;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else {
      throw new Error(`不明な引数: ${a}`);
    }
  }
  if (!args.category) {
    throw new Error('--category <カテゴリ名> が必要です');
  }
  if (!args.slug || !/^[a-z0-9][a-z0-9-]*$/u.test(args.slug)) {
    throw new Error('--slug は半角英小文字・数字・ハイフンで指定します（例 igiari）');
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function formatUploadDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})$/u.exec(String(value || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function collectClips(category) {
  const clips = [];
  for (const file of fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))) {
    const data = readJson(path.join(DATA_DIR, file));
    if (!(data.categories || []).includes(category)) {
      continue;
    }
    const base = file.slice(0, -5);
    const date = formatUploadDate(data.videoFile?.metadata?.uploadDate) || base.slice(0, 10);
    const trim = data.trimming || {};
    const duration = trim.duration ?? (trim.endTime ?? 0) - (trim.startTime ?? 0);
    clips.push({ base, date, videoId: data.videoId, duration, trimmed: Boolean(trim.original) });
  }
  return clips.sort((a, b) => a.date.localeCompare(b.date) || a.base.localeCompare(b.base));
}

function withCategoryTag(tags, category) {
  // 元プリセットのカテゴリ固有タグ（侍）を外し、新しいカテゴリを末尾に足す。
  return [...tags.filter((t) => t !== '侍' && t !== category), category];
}

function buildHorizontal(category, date) {
  const preset = readJson(path.join(PRESET_DIR, 'config-samurai.json'));
  preset.select = { ...preset.select, mode: 'category', categories: [category] };
  delete preset.select.exclude;
  preset.output = { ...preset.output, name: `output/${date}-category-${category}-kirinuki.mp4` };
  preset.summary = {
    ...preset.summary,
    intro: `にじさんじ所属・梢桃音さんの配信から「${category}」の名場面をまとめました。`,
    tags: withCategoryTag(preset.summary?.tags || [], category),
  };
  return preset;
}

function buildShorts(category, date) {
  const preset = readJson(path.join(PRESET_DIR, 'config-shorts.json'));
  preset.select = { ...preset.select, mode: 'category', categories: [category] };
  delete preset.select.exclude;
  preset.output = {
    ...preset.output,
    name: `output/shorts/${date}-category-${category}-shorts.mp4`,
    split: { ...(preset.output?.split || { by: 'stream' }), minSec: SHORTS_MIN_SEC },
  };
  return preset;
}

function writePreset(file, preset, { force, dryRun }) {
  const rel = path.relative(ROOT, file);
  if (fs.existsSync(file) && !force) {
    throw new Error(`${rel} は既にあります。上書きするなら --force を付けてください`);
  }
  if (dryRun) {
    console.log(`(dry-run) ${rel}`);
    return;
  }
  fs.writeFileSync(file, JSON.stringify(preset, null, 2) + '\n');
  console.log(`✅ ${rel}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const clips = collectClips(args.category);
  if (clips.length === 0) {
    throw new Error(`カテゴリ「${args.category}」のクリップが public/data にありません`);
  }
  const total = clips.reduce((sum, c) => sum + c.duration, 0);
  const streams = new Set(clips.map((c) => c.videoId)).size;
  const untrimmed = clips.filter((c) => !c.trimmed).map((c) => c.base);
  const date = clips[0].date;
  console.log(
    `📋 ${args.category}: ${clips.length} クリップ / ${streams} 配信 / 合計 ${total.toFixed(1)} 秒 / ${date}〜${clips.at(-1).date}`,
  );
  if (untrimmed.length > 0) {
    console.log(`⚠️ 未カット（trimming.original 無し）${untrimmed.length} 件: ${untrimmed.join(', ')}`);
  }
  writePreset(path.join(PRESET_DIR, `config-${args.slug}.json`), buildHorizontal(args.category, date), args);
  writePreset(path.join(PRESET_DIR, `config-shorts-${args.slug}.json`), buildShorts(args.category, date), args);
}

try {
  main();
} catch (error) {
  console.error(`💥 ${error.message}`);
  process.exit(1);
}
