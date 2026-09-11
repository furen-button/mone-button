import fs from 'fs';
import path from 'path';
import { relativePath, reportPathsFor } from './manifest.js';

const LEVEL_LABELS = {
  error: 'エラー',
  warn: '警告',
  info: '情報',
};

export function summarizeResults(results) {
  const summary = { error: 0, warn: 0, info: 0 };
  for (const result of results) {
    if (result.level in summary) {
      summary[result.level]++;
    }
  }
  return summary;
}

export function exitCodeForResults(results) {
  return summarizeResults(results).error > 0 ? 1 : 0;
}

export function writeQcReport({ videoPath, manifestPath = null, results, outPaths = null }) {
  const generatedAt = new Date().toISOString();
  const summary = summarizeResults(results);
  const paths = outPaths || reportPathsFor(videoPath);
  const payload = {
    version: 1,
    generatedAt,
    video: relativePath(videoPath),
    manifest: manifestPath ? relativePath(manifestPath) : null,
    summary,
    results,
  };
  fs.mkdirSync(path.dirname(paths.json), { recursive: true });
  fs.writeFileSync(paths.json, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(paths.md, renderMarkdownReport(payload));
  return { paths, payload };
}

export function renderMarkdownReport({ generatedAt, video, manifest, summary, results }) {
  const lines = [
    '# createVideo QC レポート',
    '',
    `- 生成時刻: ${generatedAt}`,
    `- 動画: ${video}`,
    `- manifest: ${manifest || 'なし'}`,
    `- 集計: error ${summary.error} / warn ${summary.warn} / info ${summary.info}`,
    '',
    '## 結果',
    '',
  ];

  if (results.length === 0) {
    lines.push('検査結果はありません。', '');
    return lines.join('\n');
  }

  for (const result of results) {
    lines.push(`- ${levelMark(result.level)} **${LEVEL_LABELS[result.level] || result.level}** ${result.code}: ${result.message}`);
    if (result.detail) {
      lines.push(`  - ${result.detail}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function formatConsoleSummary({ results, reportPaths }) {
  const summary = summarizeResults(results);
  const lines = [
    `🧪 QC: error ${summary.error} / warn ${summary.warn} / info ${summary.info}`,
  ];
  if (reportPaths) {
    lines.push(`   JSON: ${relativePath(reportPaths.json)}`);
    lines.push(`   Markdown: ${relativePath(reportPaths.md)}`);
  }
  for (const result of results.filter((item) => item.level !== 'info').slice(0, 8)) {
    lines.push(`   ${levelMark(result.level)} ${result.code}: ${result.message}`);
  }
  return lines.join('\n');
}

function levelMark(level) {
  if (level === 'error') {
    return 'ERROR';
  }
  if (level === 'warn') {
    return 'WARN';
  }
  return 'INFO';
}
