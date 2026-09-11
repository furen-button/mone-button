import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  exitCodeForResults,
  renderMarkdownReport,
  summarizeResults,
  writeQcReport,
} from './report.js';

describe('QC report', () => {
  const results = [
    { level: 'error', code: 'a', message: 'エラーです。' },
    { level: 'warn', code: 'b', message: '警告です。' },
    { level: 'info', code: 'c', message: '情報です。' },
  ];

  it('error/warn/info を集計し、error があると終了コード 1 にする', () => {
    assert.deepEqual(summarizeResults(results), { error: 1, warn: 1, info: 1 });
    assert.equal(exitCodeForResults(results), 1);
    assert.equal(exitCodeForResults(results.slice(1)), 0);
  });

  it('qc.md の見出しと集計を出す', () => {
    const markdown = renderMarkdownReport({
      generatedAt: '2026-09-10T00:00:00.000Z',
      video: 'output/a.mp4',
      manifest: null,
      summary: summarizeResults(results),
      results,
    });
    assert.ok(markdown.includes('# createVideo QC レポート'));
    assert.ok(markdown.includes('error 1 / warn 1 / info 1'));
    assert.ok(markdown.includes('**エラー** a: エラーです。'));
  });

  it('qc.json / qc.md を指定パスへ書き出す', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-report-'));
    const outPaths = {
      json: path.join(dir, 'sample.qc.json'),
      md: path.join(dir, 'sample.qc.md'),
    };
    const written = writeQcReport({ videoPath: '/tmp/sample.mp4', results, outPaths });
    assert.equal(written.paths.json, outPaths.json);
    assert.deepEqual(JSON.parse(fs.readFileSync(outPaths.json, 'utf8')).summary, { error: 1, warn: 1, info: 1 });
    assert.ok(fs.readFileSync(outPaths.md, 'utf8').includes('## 結果'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
