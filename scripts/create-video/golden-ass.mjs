#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAss,
  boxHeightFor,
  countLines,
  fontSize,
  lineBreakViolations,
  maxUnitsFor,
  resolveTitleText,
  stripEmoji,
  wrapText,
} from './ass.js';
import { buildClipElements } from './clip.js';
import { DEFAULTS, deepMerge, outputSize, projectRoot } from './config.js';
import { collectClips } from './select.js';
import { dataDir } from './assets.js';

export const ASS_GOLDEN_VERSION = 1;
export const ASS_GOLDEN_NOTE = '再生成は npm run golden:ass。wrap-golden.json とは別物で、こちらは折り返し後の fontSize・座標・ボックス形状・色まで含む';
export const ASS_GOLDEN_PRESETS = ['config.json', 'config-mone.json', 'config-matome-01.json'];

const __filename = fileURLToPath(import.meta.url);
const here = path.dirname(__filename);
const fixturePath = path.join(here, '__fixtures__', 'ass-golden.json');
const CURATED_LIMIT = 15;

export function buildAssGoldenFixture() {
  const cases = buildAssGoldenCases();
  const curated = selectCuratedAssCases(cases).map((item) => item.key).sort(compareText);
  const curatedSet = new Set(curated);
  const hashes = sortedObject(cases.map((item) => [item.key, hashAss(item.ass)]));
  const full = sortedObject(
    cases
      .filter((item) => curatedSet.has(item.key))
      .map((item) => [item.key, item.ass]),
  );

  return {
    version: ASS_GOLDEN_VERSION,
    note: ASS_GOLDEN_NOTE,
    curated,
    hashes,
    full,
  };
}

export function buildAssGoldenCases() {
  const dataFiles = listDataFiles();
  const out = [];
  for (const preset of ASS_GOLDEN_PRESETS) {
    const config = loadPresetForGolden(preset, dataFiles);
    const size = outputSize(config);
    const clips = collectClips(config);
    for (const [index, clip] of clips.entries()) {
      const elements = buildClipElements({
        clip,
        index,
        total: clips.length,
        config,
        size,
        titleOverride: null,
      });
      const ass = buildAss(elements, { width: size.width, height: size.height, font: config.font });
      out.push({
        key: `${preset}/${clip.base}`,
        preset,
        base: clip.base,
        ass,
        metrics: caseMetrics({ clip, elements, config, size }),
      });
    }
  }
  return out.sort((a, b) => compareText(a.key, b.key));
}

export function selectCuratedAssCases(cases, limit = CURATED_LIMIT) {
  const selected = new Map();
  const add = (items, take, compare) => {
    for (const item of [...items].sort(compare)) {
      if (!selected.has(item.key)) {
        selected.set(item.key, item);
      }
      if (selected.size >= take || selected.size >= limit) {
        break;
      }
    }
  };
  const addBucket = (items, take, compare) => {
    const before = selected.size;
    for (const item of [...items].sort(compare)) {
      if (!selected.has(item.key)) {
        selected.set(item.key, item);
      }
      if (selected.size - before >= take || selected.size >= limit) {
        break;
      }
    }
  };

  addBucket(cases.filter((item) => item.metrics.serifLines >= 4), 4, compareBy(
    (item) => item.metrics.serifLines,
    (item) => item.metrics.serifBoxHeight,
    (item) => item.metrics.textLength,
  ));
  addBucket(cases.filter((item) => item.metrics.titleLines >= 2), 3, compareBy(
    (item) => item.metrics.titleLines,
    (item) => item.metrics.titleBoxHeight,
    (item) => item.metrics.textLength,
  ));
  addBucket(cases.filter((item) => item.metrics.serifAtMinSize || item.metrics.titleAtMinSize), 3, compareBy(
    (item) => item.metrics.serifAtMinSize ? 1 : 0,
    (item) => item.metrics.titleAtMinSize ? 1 : 0,
    (item) => item.metrics.maxLines,
  ));
  addBucket(cases.filter((item) => item.metrics.kinsokuChanged), 3, compareBy(
    (item) => item.metrics.kinsokuChanges,
    (item) => item.metrics.kinsokuViolationsWithoutKinsoku,
    (item) => item.metrics.maxLines,
  ));
  addBucket(cases, 2, compareBy(
    (item) => item.metrics.maxLines,
    (item) => item.metrics.totalLines,
    (item) => item.metrics.textLength,
  ));
  if (selected.size < limit) {
    add(cases, limit, compareBy((item) => item.metrics.score));
  }

  return [...selected.values()].slice(0, limit).sort((a, b) => compareText(a.key, b.key));
}

export function compareAssGoldenFixture(expected, actual) {
  const problems = [];
  if (expected.version !== actual.version) {
    problems.push(`version が違います（期待 ${expected.version} / 実際 ${actual.version}）。`);
  }
  if (expected.note !== actual.note) {
    problems.push('note が違います。');
  }

  const expectedKeys = Object.keys(expected.hashes || {}).sort(compareText);
  const actualKeys = Object.keys(actual.hashes || {}).sort(compareText);
  const missing = expectedKeys.filter((key) => !(key in actual.hashes));
  const added = actualKeys.filter((key) => !(key in expected.hashes));
  const changed = expectedKeys
    .filter((key) => key in actual.hashes && expected.hashes[key] !== actual.hashes[key])
    .map((key) => ({ key, expected: expected.hashes[key], actual: actual.hashes[key] }));

  if (missing.length > 0) {
    problems.push(`fixture にあるが現在は無い組み合わせ: ${missing.join(', ')}`);
  }
  if (added.length > 0) {
    problems.push(`現在あるが fixture に無い組み合わせ: ${added.join(', ')}`);
  }
  if (changed.length > 0) {
    problems.push(`ASS が変わった組み合わせ ${changed.length} 件:`);
    for (const item of changed) {
      problems.push(`- ${item.key}: ${item.expected} -> ${item.actual}`);
    }
    for (const item of changed.filter((entry) => expected.full?.[entry.key])) {
      problems.push(...formatAssLineDiff(item.key, expected.full[item.key], actual.full?.[item.key] || ''));
    }
  }

  if (JSON.stringify(actual.curated) !== JSON.stringify(expected.curated)) {
    problems.push([
      'curated の選定結果が変わりました。',
      `期待: ${(expected.curated || []).join(', ')}`,
      `実際: ${actual.curated.join(', ')}`,
    ].join('\n'));
  }
  return {
    ok: problems.length === 0,
    message: problems.join('\n'),
  };
}

function listDataFiles() {
  return fs.readdirSync(dataDir)
    .filter((name) => name.endsWith('.json'))
    .sort(compareText);
}

function loadPresetForGolden(preset, dataFiles) {
  const presetPath = path.join(here, preset);
  const config = deepMerge(
    deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(presetPath, 'utf8'))),
    {
      select: {
        mode: 'files',
        files: dataFiles,
        exclude: [],
        order: 'as-listed',
        limit: null,
      },
    },
  );
  config.__meta = { configPath: presetPath, cli: {} };
  return config;
}

function caseMetrics({ clip, elements, config, size }) {
  const byName = new Map(elements.map((element) => [element.name, element]));
  const title = byName.get('title');
  const serif = byName.get('serif');
  const titleText = resolveTitleText({ clip, config, titleOverride: null });
  const serifText = clip.data.serif || '';
  const titleMinSize = minFontSize(config.telops.title, size.height);
  const serifMinSize = minFontSize(config.telops.serif, size.height);
  const titleKinsoku = kinsokuMetric(title, titleText, size);
  const serifKinsoku = kinsokuMetric(serif, serifText, size);
  const titleLines = countLines(title?.text || '');
  const serifLines = countLines(serif?.text || '');
  const titleBoxHeight = boxHeight(title, size);
  const serifBoxHeight = boxHeight(serif, size);
  const kinsokuChanges = Number(titleKinsoku.changed) + Number(serifKinsoku.changed);
  const kinsokuViolationsWithoutKinsoku = titleKinsoku.violations + serifKinsoku.violations;
  const textLength = [...stripEmoji(`${titleText}\n${serifText}`)].length;
  const totalLines = elements.reduce((sum, element) => sum + countLines(element.text || ''), 0);
  const maxLines = Math.max(0, ...elements.map((element) => countLines(element.text || '')));
  const serifAtMinSize = Boolean(serif && serifLines > 1 && Number(serif.size) === serifMinSize);
  const titleAtMinSize = Boolean(title && titleLines > 1 && Number(title.size) === titleMinSize);
  const score = [
    serifAtMinSize ? 80 : 0,
    titleAtMinSize ? 70 : 0,
    kinsokuChanges * 50,
    serifLines * 12,
    titleLines * 10,
    maxLines * 8,
    kinsokuViolationsWithoutKinsoku * 4,
    Math.min(textLength, 200) / 10,
  ].reduce((sum, value) => sum + value, 0);

  return {
    titleLines,
    serifLines,
    totalLines,
    maxLines,
    titleBoxHeight,
    serifBoxHeight,
    titleAtMinSize,
    serifAtMinSize,
    kinsokuChanged: kinsokuChanges > 0,
    kinsokuChanges,
    kinsokuViolationsWithoutKinsoku,
    textLength,
    score,
  };
}

function kinsokuMetric(element, rawText, size) {
  if (!element || !rawText) {
    return { changed: false, violations: 0 };
  }
  const stripped = stripEmoji(rawText);
  const maxUnits = maxUnitsFor(size.width, element.marginH, element.marginH, element.size);
  const withoutKinsoku = wrapText(stripped, maxUnits, { kinsoku: false });
  const withKinsoku = wrapText(stripped, maxUnits, { kinsoku: true });
  return {
    changed: withoutKinsoku !== withKinsoku,
    violations: lineBreakViolations(withoutKinsoku).length,
  };
}

function minFontSize(style, height) {
  return Math.min(fontSize(style.size, height), fontSize(style.minSize ?? style.size, height));
}

function boxHeight(element, size) {
  if (!element?.box?.enabled) {
    return 0;
  }
  const pad = Number(element.box.pad || 0);
  const border = Number(element.box.borderWidth || 0);
  const height = boxHeightFor(countLines(element.text), Number(element.size), pad, border);
  if (element.name === 'title') {
    return Math.max(height, Math.round(size.height * 0.07));
  }
  return height;
}

function hashAss(ass) {
  return crypto.createHash('sha256').update(ass).digest('hex').slice(0, 16);
}

function sortedObject(entries) {
  return Object.fromEntries([...entries].sort(([a], [b]) => compareText(a, b)));
}

function compareBy(...getters) {
  return (a, b) => {
    for (const getter of getters) {
      const diff = Number(getter(b)) - Number(getter(a));
      if (diff !== 0) {
        return diff;
      }
    }
    return compareText(a.key, b.key);
  };
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), 'ja');
}

function formatAssLineDiff(key, expectedText, actualText) {
  const expected = String(expectedText).split('\n');
  const actual = String(actualText).split('\n');
  const lines = [`差分 ${key}:`];
  let shown = 0;
  const max = Math.max(expected.length, actual.length);
  for (let i = 0; i < max; i++) {
    if (expected[i] === actual[i]) {
      continue;
    }
    lines.push(`  L${i + 1} 期待: ${expected[i] ?? '<行なし>'}`);
    lines.push(`  L${i + 1} 実際: ${actual[i] ?? '<行なし>'}`);
    shown++;
    if (shown >= 8) {
      lines.push('  ... 差分が多いため以降は省略');
      break;
    }
  }
  return lines;
}

function readFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  const actual = buildAssGoldenFixture();
  if (argv.includes('--check')) {
    const expected = readFixture();
    const comparison = compareAssGoldenFixture(expected, actual);
    if (!comparison.ok) {
      console.error(comparison.message);
      console.error('意図した変更なら npm run golden:ass で fixture を更新してください。');
      process.exitCode = 1;
      return;
    }
    console.log(`ASS ゴールデン検証 OK: ${Object.keys(actual.hashes).length} 通り / curated ${actual.curated.length} 件`);
    return;
  }

  fs.writeFileSync(fixturePath, `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`ASS ゴールデンを更新しました: ${path.relative(projectRoot, fixturePath)}`);
  console.log(`対象: ${Object.keys(actual.hashes).length} 通り / full 保存: ${actual.curated.length} 件`);
}

if (process.argv[1] === __filename) {
  main();
}
