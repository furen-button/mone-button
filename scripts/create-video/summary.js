import fs from 'fs';
import path from 'path';
import { formatTimestamp, stripEmphasis } from './ass.js';

// 出力は 3 系統。用途ごとに文字数上限も分割方針も違うため 1 ファイルにまとめない。
//   <name>.comment.txt … 固定コメント用のクリップ単位一覧
//   <name>.youtube.txt … 概要欄にそのまま貼る本文（チャプター + チャプターごとの出典）
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
// base は QC がチャプターの時刻を manifest のセグメントと突き合わせるのに使う。
export function buildSummaryEntry(clip, atSec) {
  const meta = clip.meta || {};
  // 強調記法（{語} / {語|RRGGBB}）はテロップ専用なので、概要欄・固定コメントでは記号を落とす。
  const serif = stripEmphasis(String(clip.data?.serif || '')).replace(/\s*\n\s*/g, ' ').trim();
  const startSec = Math.round(Number(clip.startTime) || 0);
  const clipUrl = clip.data?.clipUrl
    || (clip.videoId ? `https://youtube.com/watch?v=${clip.videoId}&t=${startSec}s` : '');
  return {
    atSec,
    base: clip.base || '',
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

// チャプターを切る。既定（by: clip）はセリフ（クリップ）ごと、by: stream は直前と videoId が
// 変わった位置で切る。どちらも 10 秒未満の区間は YouTube の規格を満たさないのでまとめる。
export function buildChapters(entries, totalSec, options = {}) {
  const minSec = Number(options.minSec ?? 10);
  const labels = options.labels || {};
  if (entries.length === 0) {
    return { chapters: [], warnings: [] };
  }

  const chapters = options.by === 'stream'
    ? buildStreamChapters(entries, totalSec, minSec, labels)
    : buildClipChapters(entries, totalSec, minSec, labels);
  if (chapters.length < YOUTUBE_MIN_CHAPTERS) {
    const warnings = [
      `チャプターが ${chapters.length} 個しかないため概要欄から省きます`
      + `（YouTube は 3 つ以上・各 ${minSec} 秒以上を要求します）。`,
    ];
    return { chapters: [], warnings };
  }
  return { chapters, warnings: [] };
}

// セリフごとのチャプター。見出しはまとめたセリフを「 / 」でつなぎ、出典用にクリップの URL を持つ。
// labels はチャプター先頭のクリップ名（base）で見出しを上書きする。
function buildClipChapters(entries, totalSec, minSec, labels) {
  return groupClipChapters(entries, totalSec, minSec).map((group, i) => {
    // 先頭は必ず 0:00 でなければならない。OP カードのぶんだけ最初のクリップは 0 秒に来ない。
    const sec = i === 0 ? 0 : Math.round(group.start);
    return {
      sec,
      time: formatTimestamp(sec),
      label: clipChapterLabel(group, labels),
      videoId: group.entries[0].videoId,
      bases: group.entries.map((entry) => entry.base),
      urls: group.entries.map((entry) => entry.clipUrl).filter(Boolean),
    };
  });
}

// クリップを前から順にまとめ、合計が minSec 以上になったら次のチャプターを始める。
// 末尾だけ短く残ったら直前へ寄せる。先頭のチャプターは 0:00 から始まるものとして長さを測る。
export function groupClipChapters(entries, totalSec, minSec = 10) {
  const groups = [];
  for (const [i, entry] of entries.entries()) {
    // 境界は出力と同じ整数秒で判定し、末尾だけは総尺までの実際の長さを使う。
    const start = i === 0 ? 0 : Math.round(entry.atSec);
    const end = i + 1 < entries.length ? Math.round(entries[i + 1].atSec) : totalSec;
    const last = groups.at(-1);
    if (last && last.end - last.start < minSec) {
      last.end = end;
      last.entries.push(entry);
      continue;
    }
    groups.push({ start, end, entries: [entry] });
  }
  const tail = groups.at(-1);
  if (groups.length > 1 && tail.end - tail.start < minSec) {
    groups.pop();
    groups.at(-1).end = tail.end;
    groups.at(-1).entries.push(...tail.entries);
  }
  return groups;
}

function clipChapterLabel(group, labels) {
  const override = labels[group.entries[0].base];
  if (override) {
    return override;
  }
  const serifs = group.entries.map((entry) => entry.serif).filter(Boolean);
  return serifs.length > 0 ? serifs.join(' / ') : chapterLabelFor(group.entries[0].title);
}

// 概要欄の出典（by: clip）。チャプターと同じまとまりごとに、見出しとタイムスタンプ付き URL を並べる。
// チャプターが 3 個未満で省かれても出典は残すため、チャプターとは別に組み立てる。
export function buildClipSources(entries, totalSec, options = {}) {
  const minSec = Number(options.minSec ?? 10);
  const labels = options.labels || {};
  return groupClipChapters(entries, totalSec, minSec).map((group) => ({
    label: clipChapterLabel(group, labels),
    urls: group.entries.map((entry) => entry.clipUrl).filter(Boolean),
  }));
}

// 配信ごとのチャプター。見出しは配信タイトルを整形したもので、labels は videoId / "videoId#N" で上書きする。
function buildStreamChapters(entries, totalSec, minSec, labels) {
  const groups = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last && last.videoId === entry.videoId) {
      continue;
    }
    groups.push({ videoId: entry.videoId, start: groups.length === 0 ? 0 : Math.round(entry.atSec), title: entry.title });
  }
  for (const [i, group] of groups.entries()) {
    // 末尾は総尺を丸めず、実際の残り時間で判定する。
    group.end = i + 1 < groups.length ? groups[i + 1].start : totalSec;
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

  // 同じ配信が離れた位置で再登場することがある（総集編の末尾に名場面を集めるなど）ので、
  // labels は videoId だけでなく "videoId#2" の形でも指定できるようにする。
  const seenCount = new Map();
  return merged.map((group, i) => {
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
}

// 配信単位の出典（by: stream の概要欄と meta.json）。同じ配信の再登場はまとめる。
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
// clipSources があればチャプターごとの出典（見出し + タイムスタンプ付き URL）、無ければ配信一覧を出す。
// 出典の見出しには時刻を付けない。行頭の時刻は YouTube がチャプターとして読み取ってしまうため。
export function renderYoutubeDescription({ chapters, sources, clipSources = [], summary }) {
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
  if (clipSources.length > 0) {
    const groups = clipSources.map((s) => [s.label, ...s.urls].filter(Boolean).join('\n'));
    blocks.push(`▼出典\n${groups.join('\n\n')}`);
  } else if (sources.length > 0) {
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
    // by: clip のチャプターは、QC が時刻を突き合わせるクリップ名と出典 URL も残す。
    chapters: chapters.map(({ sec, time, label, bases, urls }) => ({
      sec,
      time,
      label,
      ...(bases ? { bases, urls } : {}),
    })),
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
  const clipSources = chapterOptions.by === 'stream' ? [] : buildClipSources(entries, totalSec, chapterOptions);
  const maxChars = Number(summary.maxChars ?? 5000);

  const youtube = renderYoutubeDescription({
    chapters: chapterResult.chapters,
    sources,
    clipSources,
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
