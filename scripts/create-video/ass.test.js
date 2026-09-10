import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  boxHeightFor,
  buildAss,
  charWidth,
  countLines,
  escapeAssText,
  makeTextElement,
  maxUnitsFor,
  resolveTitleText,
  stripEmoji,
  wrapText,
} from './ass.js';
import { DEFAULTS, deepMerge } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  fs.readFileSync(path.join(here, '__fixtures__', 'wrap-golden.json'), 'utf8'),
);
const dataDir = path.resolve(here, '../../public/data');
const realTexts = [...new Set(
  fs.readdirSync(dataDir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      const clip = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
      return [clip.serif, clip.meta?.title].filter(Boolean).map((text) => stripEmoji(text));
    }),
)];

// runs は「出力が変わる maxUnits」だけを記録した RLE。全 maxUnits に展開して返す。
function expandRuns(runs, [min, max]) {
  const out = new Map();
  let cursor = 0;
  for (let mu = min; mu <= max; mu++) {
    while (cursor + 1 < runs.length && runs[cursor + 1][0] <= mu) {
      cursor++;
    }
    out.set(mu, runs[cursor][1]);
  }
  return out;
}

function lineCount(text) {
  return text ? String(text).split('\n').length : 0;
}

function loadPreset(fileName) {
  return deepMerge(
    DEFAULTS,
    JSON.parse(fs.readFileSync(path.join(here, fileName), 'utf8')),
  );
}

function fontSizeForTest(value, height) {
  const numeric = Number(value);
  return Math.max(1, Math.round(numeric > 0 && numeric <= 1 ? height * numeric : numeric));
}

function titleBoxHeight(config, text) {
  const size = { width: 1920, height: 1080 };
  const element = makeTextElement({
    name: 'title',
    text,
    style: config.telops.title,
    width: size.width,
    height: size.height,
    duration: 3,
  });
  const ass = buildAss([element], { width: size.width, height: size.height, font: config.font });
  const shape = ass.split('\n').find((line) => line.includes('\\p1'));
  assert.ok(shape);
  const match = shape.match(/m 0 0 l \d+ 0 \d+ (\d+) 0 \1/u);
  assert.ok(match, shape);
  return Number(match[1]);
}

describe('charWidth', () => {
  it('U+02FF 以下と半角カナを 0.5 幅として数える', () => {
    assert.equal(charWidth('a'), 0.5);
    assert.equal(charWidth('˿'), 0.5);
    assert.equal(charWidth('ｱ'), 0.5);
    assert.equal(charWidth('ﾟ'), 0.5);
  });

  it('U+0300 以上の全角文字を 1 幅として数える', () => {
    assert.equal(charWidth('̀'), 1);
    assert.equal(charWidth('あ'), 1);
    assert.equal(charWidth('【'), 1);
    assert.equal(charWidth('🎉'), 1);
  });
});

describe('wrapText の後方互換', () => {
  // 禁則処理を入れる前の出力を固定した基準値。kinsoku を切れば完全一致し続けること。
  it(`実データ ${golden.inputs} 文字列 × maxUnits ${golden.range[0]}..${golden.range[1]} が基準値と一致する`, () => {
    let checked = 0;
    for (const { input, runs } of golden.cases) {
      const expected = expandRuns(runs, golden.range);
      const stripped = stripEmoji(input);
      for (const [maxUnits, want] of expected) {
        const got = wrapText(stripped, maxUnits, { kinsoku: false });
        assert.equal(got, want, `maxUnits=${maxUnits} / input=${JSON.stringify(input)}`);
        checked++;
      }
    }
    assert.equal(checked, golden.inputs * (golden.range[1] - golden.range[0] + 1));
  });
});

describe('wrapText の改行制御', () => {
  it('手動改行を ASS の強制改行として残し、余分な空行を作らない', () => {
    const wrapped = wrapText(stripEmoji('あいう\nかきく'), 3);
    assert.equal(wrapped, 'あいう\nかきく');
    assert.equal(wrapText(stripEmoji('あいう\n'), 3), 'あいう');
    assert.equal(wrapText(stripEmoji('あいう\n\n\nかきく'), 3), 'あいう\n\nかきく');
    assert.equal(escapeAssText(wrapped), 'あいう\\Nかきく');
  });

  it('行頭禁則と行末禁則を分割位置の後退で避ける', () => {
    const noPunctuationHead = wrapText('あいうえお。かき', 5).split('\n');
    assert.ok(!noPunctuationHead.some((line) => /^[。っ]/u.test(line)));

    const noOpeningBracketTail = wrapText('あいうえ（かき', 5).split('\n');
    assert.ok(!noOpeningBracketTail.some((line) => /（$/u.test(line)));
  });

  it('maxUnits が 4 未満のときは禁則処理を無効化する', () => {
    const text = 'あいうえお。かき';
    assert.equal(wrapText(text, 3), wrapText(text, 3, { kinsoku: false }));
  });

  it('泣き別れ回避は 1 行に収まるケースでは発火しない', () => {
    assert.equal(wrapText('あいうえ', 10), 'あいうえ');
  });

  it('実データで禁則有効時の行数が禁則無効時を超えない', () => {
    for (const text of realTexts) {
      for (let maxUnits = 4; maxUnits <= golden.range[1]; maxUnits++) {
        const withoutKinsoku = lineCount(wrapText(text, maxUnits, { kinsoku: false }));
        const withKinsoku = lineCount(wrapText(text, maxUnits, { kinsoku: true }));
        assert.ok(
          withKinsoku <= withoutKinsoku,
          `maxUnits=${maxUnits} / ${withKinsoku} > ${withoutKinsoku} / input=${JSON.stringify(text)}`,
        );
      }
    }
  });

  it('実データで maxUnits を増やしても行数が増えない', () => {
    for (const text of realTexts) {
      let previous = Infinity;
      for (let maxUnits = 4; maxUnits <= golden.range[1]; maxUnits++) {
        const current = lineCount(wrapText(text, maxUnits, { kinsoku: true }));
        assert.ok(
          current <= previous,
          `maxUnits=${maxUnits} / ${current} > ${previous} / input=${JSON.stringify(text)}`,
        );
        previous = current;
      }
    }
  });
});

describe('テロップボックス高さ', () => {
  it('countLines は ASS 強制改行と通常改行を同じ行数として数える', () => {
    assert.equal(countLines('a\nb\\Nc'), 3);
  });

  it('同梱 3 プリセットの 1080p 1 行タイトルバーは 76px のまま', () => {
    for (const fileName of ['config.json', 'config-mone.json', 'config-matome-01.json']) {
      assert.equal(titleBoxHeight(loadPreset(fileName), '梢桃音'), 76, fileName);
    }
  });

  it('複数行タイトルバーは行数に追従し、最低高さを維持する', () => {
    const config = loadPreset('config-mone.json');
    config.telops.title.autoShrink = false;
    const fsPx = fontSizeForTest(config.telops.title.size, 1080);
    const pad = Number(config.telops.title.box.pad || 0);
    const border = Number(config.telops.title.box.borderWidth || 0);
    const expected = Math.max(boxHeightFor(2, fsPx, pad, border), Math.round(1080 * 0.07));
    assert.equal(titleBoxHeight(config, '上段\n下段'), expected);
    assert.ok(expected > 76);
  });
});

describe('autoShrink', () => {
  it('minSize が size を超えてもフォントサイズを拡大しない', () => {
    const element = makeTextElement({
      name: 'title',
      text: 'あ'.repeat(80),
      style: {
        enabled: true,
        align: 'top-center',
        size: 0.03,
        minSize: 0.05,
        maxHeight: 0.04,
        autoShrink: true,
        box: { enabled: true, fill: '000000', pad: 15 },
      },
      width: 1920,
      height: 1080,
      duration: 3,
    });
    assert.ok(element.size <= fontSizeForTest(0.03, 1080));
  });

  it('実際の折り返し箱高さで収まる最大の整数フォントサイズを選ぶ', () => {
    const style = {
      enabled: true,
      align: 'bottom-center',
      size: 0.08,
      minSize: 0.02,
      maxHeight: 0.1,
      autoShrink: true,
      box: { enabled: true, fill: 'FFFFFF', borderWidth: 6, pad: 10 },
    };
    const width = 1920;
    const height = 1080;
    const marginH = Math.round(width * 0.08);
    const element = makeTextElement({
      name: 'serif',
      text: 'あ'.repeat(40),
      style,
      width,
      height,
      duration: 3,
    });
    const budget = Math.round(height * style.maxHeight);
    const pad = Number(style.box.pad || 0);
    const border = Number(style.box.borderWidth || 0);
    const actualHeight = boxHeightFor(countLines(element.text), element.size, pad, border);
    assert.ok(actualHeight <= budget);

    const nextFs = element.size + 1;
    if (nextFs <= fontSizeForTest(style.size, height)) {
      const nextWrapped = wrapText('あ'.repeat(40), maxUnitsFor(width, marginH, marginH, nextFs));
      const nextHeight = boxHeightFor(countLines(nextWrapped), nextFs, pad, border);
      assert.ok(nextHeight > budget);
    }
  });
});

describe('resolveTitleText', () => {
  it('CLI、videoId 上書き、共通 text、clip.data.title、meta.title の順で解決する', () => {
    const clip = {
      videoId: 'abc123',
      data: { title: 'clip title' },
      meta: { title: 'meta title🎉' },
    };
    const config = deepMerge(DEFAULTS, {
      telops: {
        title: {
          text: 'common title',
          overrides: { abc123: 'override title' },
        },
      },
    });

    assert.equal(resolveTitleText({ clip, config, titleOverride: 'cli title' }), 'cli title');
    assert.equal(resolveTitleText({ clip, config, titleOverride: null }), 'override title');
    config.telops.title.overrides = {};
    assert.equal(resolveTitleText({ clip, config, titleOverride: null }), 'common title');
    config.telops.title.text = null;
    assert.equal(resolveTitleText({ clip, config, titleOverride: null }), 'clip title');
    delete clip.data.title;
    assert.equal(resolveTitleText({ clip, config, titleOverride: null }), 'meta title');
  });
});

describe('折り返し行の端の空白', () => {
  // \an5 の中央寄せでは行端の空白がその行だけ中心をずらすため、実データで残らないこと。
  it('実データの serif に行頭・行末の空白を残さない', () => {
    const dataDir = path.resolve(here, '..', '..', 'public', 'data');
    const offenders = [];
    for (const name of fs.readdirSync(dataDir).filter((n) => n.endsWith('.json'))) {
      const clip = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
      if (!clip.serif) {
        continue;
      }
      for (const maxUnits of [12, 18, 24]) {
        for (const line of wrapText(stripEmoji(clip.serif), maxUnits).split('\n')) {
          if (/^[ 　]|[ 　]$/.test(line)) {
            offenders.push(`${name} maxUnits=${maxUnits} ${JSON.stringify(line)}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('区切りに使った空白を落としても行数は増えない', () => {
    const text = 'これからさ、 どんなことがあってもさ、 もねと一緒だよ?';
    const withKinsoku = wrapText(text, 18).split('\n');
    const legacy = wrapText(text, 18, { kinsoku: false }).split('\n');
    assert.ok(withKinsoku.length <= legacy.length);
    for (const line of withKinsoku) {
      assert.equal(line, line.trim());
    }
  });
});
