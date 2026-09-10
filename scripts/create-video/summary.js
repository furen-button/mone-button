import fs from 'fs';
import path from 'path';
import { formatTimestamp } from './ass.js';

// 出力は 3 系統。用途ごとに文字数上限も分割方針も違うため 1 ファイルにまとめない。
//   <name>.comment.txt … 固定コメント用のクリップ単位一覧
//   <name>.youtube.txt … 概要欄にそのまま貼る本文（チャプター + 配信単位の出典）
//   <name>.meta.json   … タイトル案 / タグ / チャプター配列。将来の Data API 自動化用

// YouTube のチャプターは先頭 0:00 必須 / 3 つ以上 / 各区間 10 秒以上。
const YOUTUBE_MIN_CHAPTERS = 3;

// 出力動画のパスから 3 系統の出力先を導く。
export function summaryPathsFor(videoOutPath) {
  const dir = path.dirname(videoOutPath);
  const base = path.basename(videoOutPath, path.extname(videoOutPath));
  return {
    base,
    comment: path.join(dir, `${base}.comment.txt`),
    youtube: path.join(dir, `${base}.youtube.txt`),
    meta: path.join(dir, `${base}.meta.json`),
  };
}

// クリップと動画内の開始秒から 1 エントリ分の情報を作る。
// チャプター境界の判定と出典一覧に videoId / sourceUrl が要るので併せて持つ。
export function buildSummaryEntry(clip, atSec) {
  const meta = clip.meta || {};
  const serif = String(clip.data?.serif || '').replace(/\s*\n\s*/g, ' ').trim();
  const startSec = Math.round(Number(clip.startTime) || 0);
  const clipUrl = clip.data?.clipUrl
    || (clip.videoId ? `https://youtube.com/watch?v=${clip.videoId}&t=${startSec}s` : '');
  return {
    atSec,
    serif,
    videoId: clip.videoId || '',
    title: (meta.title || '').trim(),
    sourceUrl: meta.url || (clip.videoId ? `https://www.youtube.com/watch?v=${clip.videoId}` : ''),
    uploadDate: meta.uploadDate || '',
    clipUrl,
  };
}

// 【X】Y【…にじさんじ】 のような配信タイトルをチャプター向けに短くする。
// 例: 【初配信】これはきっと運命の出会い【梢桃音/にじさんじ】 → 初配信 - これはきっと運命の出会い
export function chapterLabelFor(title) {
  let text = String(title || '').trim();
  // 末尾の 【演者名/所属】 は全チャプターで共通なので落とす。配信によって 『』 表記もある。
  text = text.replace(/\s*(?:【[^】]*】|『[^』]*』)\s*$/, '').trim();
  // 括弧を落とした結果、末尾に区切り記号だけが残ることがある。
  text = text.replace(/[\s\-–—|／/｜]+$/, '').trim();
  const leading = text.match(/^【([^】]+)】\s*(.*)$/);
  if (leading) {
    const [, tag, rest] = leading;
    return rest ? `${tag} - ${rest}`.trim() : tag.trim();
  }
  return text;
}

// 直前と videoId が変わった位置でチャプターを切る。
// 10 秒未満の区間は YouTube の規格を満たさないので隣へ寄せる。
export function buildChapters(entries, totalSec, options = {}) {
  const minSec = Number(options.minSec ?? 10);
  const labels = options.labels || {};
  if (entries.length === 0) {
    return { chapters: [], warnings: [] };
  }

  const groups = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last && last.videoId === entry.videoId) {
      continue;
    }
    groups.push({ videoId: entry.videoId, start: entry.atSec, title: entry.title });
  }
  for (const [i, group] of groups.entries()) {
    group.end = i + 1 < groups.length ? groups[i + 1].start : Math.max(totalSec, group.start);
  }

  // 短い区間は直前へ吸収する。ラベルは既にそのチャプターが始まっている側を残す。
  const merged = [];
  for (const group of groups) {
    if (merged.length > 0 && group.end - group.start < minSec) {
      merged.at(-1).end = group.end;
      continue;
    }
    merged.push({ ...group });
  }
  // 先頭だけは吸収先が後ろになる。始点は 0 のまま、ラベルは長いほうの後続を採る。
  while (merged.length > 1 && merged[0].end - merged[0].start < minSec) {
    merged[1].start = merged[0].start;
    merged.shift();
  }

  const warnings = [];
  if (merged.length < YOUTUBE_MIN_CHAPTERS) {
    warnings.push(
      `チャプターが ${merged.length} 個しかないため概要欄から省きます`
      + `（YouTube は 3 つ以上・各 ${minSec} 秒以上を要求します）。`,
    );
    return { chapters: [], warnings };
  }

  // 同じ配信が離れた位置で再登場することがある（総集編の末尾に名場面を集めるなど）ので、
  // labels は videoId だけでなく "videoId#2" の形でも指定できるようにする。
  const seenCount = new Map();
  const chapters = merged.map((group, i) => {
    // 先頭は必ず 0:00 でなければならない。OP カードのぶんだけ最初のクリップは 0 秒に来ない。
    const sec = i === 0 ? 0 : Math.round(group.start);
    const occurrence = (seenCount.get(group.videoId) || 0) + 1;
    seenCount.set(group.videoId, occurrence);
    const label = labels[`${group.videoId}#${occurrence}`]
      ?? labels[group.videoId]
      ?? chapterLabelFor(group.title);
    return {
      sec,
      time: formatTimestamp(sec),
      label,
      videoId: group.videoId,
      occurrence,
    };
  });
  return { chapters, warnings };
}

// 出典は配信単位。同じ配信の再登場はまとめる。
export function buildSources(entries) {
  const seen = new Map();
  for (const entry of entries) {
    if (!entry.videoId || seen.has(entry.videoId)) {
      continue;
    }
    seen.set(entry.videoId, {
      videoId: entry.videoId,
      title: entry.title,
      url: entry.sourceUrl,
      uploadDate: entry.uploadDate,
    });
  }
  return [...seen.values()];
}

// 概要欄本文。設定が空の節は見出しごと落とす。
export function renderYoutubeDescription({ chapters, sources, summary }) {
  const blocks = [];
  const head = [summary.intro, summary.notice].filter(Boolean);
  if (head.length > 0) {
    blocks.push(head.join('\n'));
  }
  if (summary.siteUrl) {
    blocks.push(`▼ボタンで遊べるサイト「もねボタン」\n${summary.siteUrl}`);
  }
  if (summary.officialChannelUrl) {
    blocks.push(`▼梢桃音さん 公式チャンネル\n${summary.officialChannelUrl}`);
  }
  if (chapters.length > 0) {
    const lines = chapters.map((c) => `${c.time} ${c.label}`.trimEnd());
    blocks.push(['▼チャプター', ...lines].join('\n'));
  }
  if (sources.length > 0) {
    const lines = sources.flatMap((s) => [s.title, s.url].filter(Boolean));
    blocks.push(['▼出典（配信一覧）', ...lines].join('\n'));
  }
  for (const extra of summary.footer || []) {
    blocks.push(extra);
  }
  return `${blocks.join('\n\n')}\n`;
}

// 固定コメント用のクリップ単位一覧。上限を超えたら空行の区切りで分割する。
export function renderCommentList(entries, maxChars) {
  const items = [];
  let prevTitle = null;
  for (const entry of entries) {
    items.push({
      head: `${formatTimestamp(entry.atSec)} ${entry.serif}`.trimEnd(),
      title: entry.title || '',
      // 直前と同じ配信ならタイトルは省く。配信の変わり目が分かるようにするため。
      needsTitle: Boolean(entry.title) && entry.title !== prevTitle,
      url: entry.clipUrl || '',
    });
    if (entry.title) {
      prevTitle = entry.title;
    }
  }

  // 分割すると 2 つ目以降が出典不明で始まってしまうので、各塊の先頭では必ずタイトルを出す。
  const renderBlock = (item, atChunkStart) => {
    const lines = [item.head];
    if (item.title && (item.needsTitle || atChunkStart)) {
      lines.push(item.title);
    }
    if (item.url) {
      lines.push(item.url);
    }
    return lines.join('\n');
  };

  // 末尾の改行 1 文字ぶんを見込んで上限を 1 減らす。
  const limit = Number(maxChars) > 0 ? Number(maxChars) - 1 : Infinity;
  const chunks = [];
  let current = [];
  let length = 0;
  for (const item of items) {
    let block = renderBlock(item, current.length === 0);
    if (current.length > 0 && length + 2 + block.length > limit) {
      chunks.push(`${current.join('\n\n')}\n`);
      current = [];
      length = 0;
      block = renderBlock(item, true);
    }
    length += (current.length > 0 ? 2 : 0) + block.length;
    current.push(block);
  }
  if (current.length > 0) {
    chunks.push(`${current.join('\n\n')}\n`);
  }
  return chunks;
}

export function buildMeta({ entries, chapters, sources, summary, totalSec, videoOutPath }) {
  return {
    output: path.basename(videoOutPath),
    durationSec: Math.round(totalSec * 100) / 100,
    clipCount: entries.length,
    titleCandidates: summary.titleCandidates || [],
    tags: summary.tags || [],
    chapters: chapters.map(({ sec, time, label }) => ({ sec, time, label })),
    sources,
  };
}

// 3 系統をまとめて書き出す。戻り値は書いたパスと警告。
export function writeSummary({ videoOutPath, entries, totalSec, config }) {
  const summary = config?.summary || {};
  const paths = summaryPathsFor(videoOutPath);
  const warnings = [];
  const written = [];

  const chapterOptions = summary.chapters || {};
  const chapterResult = chapterOptions.enabled === false
    ? { chapters: [], warnings: [] }
    : buildChapters(entries, totalSec, chapterOptions);
  warnings.push(...chapterResult.warnings);

  const sources = buildSources(entries);
  const maxChars = Number(summary.maxChars ?? 5000);

  const youtube = renderYoutubeDescription({
    chapters: chapterResult.chapters,
    sources,
    summary,
  });
  fs.writeFileSync(paths.youtube, youtube);
  written.push(paths.youtube);
  if (maxChars > 0 && youtube.length > maxChars) {
    warnings.push(`概要欄が ${youtube.length} 文字で上限 ${maxChars} を超えています。`);
  }

  const chunks = renderCommentList(entries, maxChars);
  if (chunks.length === 1) {
    fs.writeFileSync(paths.comment, chunks[0]);
    written.push(paths.comment);
  } else {
    const dir = path.dirname(paths.comment);
    for (const [i, chunk] of chunks.entries()) {
      const target = path.join(dir, `${paths.base}.comment-${i + 1}.txt`);
      fs.writeFileSync(target, chunk);
      written.push(target);
    }
    warnings.push(`クリップ一覧が上限 ${maxChars} 文字を超えるため ${chunks.length} 分割しました。`);
  }

  const meta = buildMeta({
    entries,
    chapters: chapterResult.chapters,
    sources,
    summary,
    totalSec,
    videoOutPath,
  });
  fs.writeFileSync(paths.meta, `${JSON.stringify(meta, null, 2)}\n`);
  written.push(paths.meta);

  return { written, warnings, chapters: chapterResult.chapters, sources };
}
