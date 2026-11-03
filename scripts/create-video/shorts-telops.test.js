import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAss, fitShortsTitle, makeTextElement, elementTextRect, elementTextLineRects } from './ass.js';
import { DEFAULTS, deepMerge, loadConfig } from './config.js';
import { buildClipElements } from './clip.js';
import { runStaticChecks } from './qc/checks/static.js';

const size = { width: 1080, height: 1920, fps: 30 };
const titleStyle = { marginH: 0.035 };
const serifStyle = { enabled: true, layout: 'space-lines', align: 'bottom-center', size: 100,
  marginH: 0.16, marginV: 0.23, maxHeight: 0.18, color: 'FF4FA0',
  box: { enabled: false }, fade: [80, 80], outlines: [{ width: 9, color: 'FFFFFF' }, { width: 4, color: '6B3FA0' }] };

function serif(text, style = {}) {
  return makeTextElement({ name: 'serif', text, style: { ...serifStyle, ...style }, ...size, duration: 3 });
}

describe('Shorts title', () => {
  it('末尾の演者表記を取り、20文字×2行と最下行の日付を作る。40文字を超えたら19文字+…', () => {
    for (const suffix of ['【梢桃音/にじさんじ】', '『梢桃音/にじさんじ』']) {
      const fit = fitShortsTitle({ title: `${'あ'.repeat(41)} ${suffix}`, date: '20260102', style: titleStyle, width: 1080 });
      assert.deepEqual(fit.text.split('\n'), ['あ'.repeat(20), `${'あ'.repeat(19)}…`, '2026/01/02']);
    }
    const exact = fitShortsTitle({ title: '𠮷'.repeat(40), date: '20260102', style: titleStyle, width: 1080 });
    assert.deepEqual(exact.text.split('\n').map(line => [...line].length), [20, 20, 10]);
    assert.ok(!exact.text.includes('…'));
    assert.equal(fitShortsTitle({ title: '短い題', date: '20260102', style: titleStyle, width: 1080 }).text, '短い題\n2026/01/02');
  });

  it('【の直前・】の直後で分け、タイトルは2行までにする', () => {
    const fit = title => fitShortsTitle({ title, date: '20240713', style: titleStyle, width: 1080 }).text.split('\n');
    assert.deepEqual(fit('【クリア耐久】スーパーマリオブラザーズそろそろ終止符を…打たなくては！【梢桃音/にじさんじ】'),
      ['【クリア耐久】', 'スーパーマリオブラザーズそろそろ終止符…', '2024/07/13']);
    assert.deepEqual(fit('前置き【話題】続き'), ['前置き', '【話題】…', '2024/07/13']);
    assert.deepEqual(fit('【一】前半【二】後半'), ['【一】', '前半…', '2024/07/13']);
  });

  it('20文字を超える【…】も20文字で折り、2行を超えれば省略する', () => {
    const fit = fitShortsTitle({ title: `【${'あ'.repeat(25)}】続き【演者】`, date: '20240713', style: titleStyle, width: 1080 });
    assert.deepEqual(fit.text.split('\n'), [`【${'あ'.repeat(19)}`, `${'あ'.repeat(6)}】…`, '2024/07/13']);
  });

  it('タイトル帯を下端へ付け、上端配置とoffsetYを維持する', () => {
    const cfg = loadConfig(['--config', 'scripts/create-video/config-shorts.json']);
    const clip = { data: {}, meta: { title: '【題】本文', uploadDate: '20240713' }, startTime: 0, endTime: 2 };
    const title = buildClipElements({ clip, config: cfg, size, index: 0, total: 1 }).find(el => el.name === 'title');
    const ass = buildAss([title], { ...size, font: 'Hiragino Sans' });
    assert.ok(ass.includes('\\pos(0,1709)'));
    const top = { ...title, textPos: null, box: { ...title.box, anchor: 'top', offsetY: 0 } };
    assert.ok(buildAss([top], { ...size, font: 'Hiragino Sans' }).includes('\\pos(0,0)'));
    const inset = { ...top, textPos: null, box: { ...top.box, offsetY: 0.1 } };
    assert.ok(buildAss([inset], { ...size, font: 'Hiragino Sans' }).includes('\\pos(0,192)'));
  });

  it('20全角文字が内幅へ収まる最大サイズで、既存wrapを通さず機械的な行を維持する', () => {
    const config = loadConfig(['--config', 'scripts/create-video/config-shorts.json']);
    const clip = { data: {}, meta: { title: 'あ'.repeat(41), uploadDate: '20260102' }, startTime: 0, endTime: 2 };
    const title = buildClipElements({ clip, config, size, index: 0, total: 1 }).find(el => el.name === 'title');
    assert.equal(title.size, 48);
    assert.deepEqual(title.text.split('\n'), ['あ'.repeat(20), `${'あ'.repeat(19)}…`, '2026/01/02']);
    const available = 1080 - title.marginL - title.marginR;
    assert.ok(20 * title.size / 0.97 <= available);
    assert.ok(20 * (title.size + 1) / 0.97 > available);
    assert.ok(buildAss([title], { ...size, font: 'Hiragino Sans' }).includes('\\q2'));
  });
});

describe('Shorts space-lines serif', () => {
  it('半角スペースと手動改行だけで分ける。全角空白や長い行は自動で割らない', () => {
    const el = serif('短い 長い行を勝手に分割しない\n手動　改行\n全角　　空白');
    assert.deepEqual(el.text.split('\n'), ['短い', '長い行を勝手に分割しない', '手動　改行', '全角　　空白']);
    assert.ok(el.lineSizes.every((fs) => fs === el.lineSizes[0]));
    const block = elementTextRect(el, size.width, size.height);
    const lines = elementTextLineRects(el, size.width, size.height);
    assert.equal(lines.length, 4);
    assert.deepEqual(lines.map(r => r.h), el.lineSizes);
    assert.ok(block.h <= Math.ceil(size.height * 0.18));
    assert.ok(Math.abs(block.y + block.h - 1920 * 0.77) <= 1);
    assert.ok(lines.every(r => r.x >= 1080 * 0.16 - 1 && r.x + r.w <= 1080 * 0.84 + 1));
  });

  it('区切りだけのセリフは描画要素を作らない', () => {
    assert.equal(serif('  \n \r\n '), null);
  });

  it('全行を最も長い行が幅に収まる同じ大きさにし、高さ超過時は全行を同じだけ縮める', () => {
    const original = serif('短い とても長い行になっているよね', { size: 150, maxHeight: 1 });
    assert.equal(original.lineSizes.length, 2);
    assert.equal(original.lineSizes[0], original.lineSizes[1]);
    assert.ok(original.lineSizes[0] < 150);
    // 最も長い行は、実測の字幅（fs × 0.66）で内幅いっぱいになる。
    const available = 1080 - 2 * Math.round(1080 * 0.16);
    const [, longLine] = elementTextLineRects(original, 1080, 1920);
    assert.ok(longLine.w <= available && longLine.w > available * 0.95);
    assert.equal(serif('短い 一行', { size: 150, maxHeight: 1 }).lineSizes.join(), '150,150');
    const shrunk = serif('短い とても長い行になっているよね', { size: 150, maxHeight: 0.05 });
    assert.equal(shrunk.lineSizes[0], shrunk.lineSizes[1]);
    assert.equal(shrunk.lineSizes[0], Math.floor(96 / (2 * 1.25)));
  });

  it('行ごとのDialogueにも強調色・二重縁取り・fadeが残る。同じ語の再登場を区別する', () => {
    const el = serif('同じ {同じ|FF0000} {黄}', { karaoke: true });
    const ass = buildAss([el], { ...size, font: 'Hiragino Sans' });
    const dialogues = ass.split('\n').filter(line => line.startsWith('Dialogue:'));
    assert.equal(dialogues.length, 6);
    assert.ok(dialogues.every(line => line.includes('\\fad(80,80)') && line.includes('\\q2')));
    assert.ok(dialogues.slice(0, 2).every(line => !line.includes('\\1c&H000000FF&')));
    assert.ok(dialogues.slice(2, 4).every(line => line.includes('\\1c&H000000FF&')));
    assert.ok(dialogues.slice(4).every(line => line.includes('\\1c&H0000D8FF&')));
    assert.ok(ass.includes('\\bord13') && ass.includes('\\bord9'));
    assert.ok(!ass.includes('\\kf'));
  });

  it('L0は意図した改行の禁則・行数を警告せず、矩形の衝突・画面外は検査する', () => {
    const config = deepMerge(DEFAULTS, {
      select: { mode: 'files', files: ['test'], order: 'as-listed' },
      source: 'cache', cards: { enabled: false }, summary: { enabled: false },
      endcaps: { opening: { enabled: false }, ending: { enabled: false } },
      telops: { title: { enabled: false }, date: { enabled: false }, time: { enabled: false }, progress: { enabled: false }, serif: serifStyle },
    });
    const clip = { base: 'test', videoId: 'test', startTime: 0, endTime: 3, categories: ['test'], data: { serif: '一行 」二行 三行 四行 五行 六行', clipUrl: 'https://example.com' } };
    const check = cfg => runStaticChecks({ config: cfg, clips: [clip], size }).map(r => r.code);
    const codes = check(config);
    assert.ok(!codes.includes('static_kinsoku_violation'));
    assert.ok(!codes.includes('static_serif_lines'));
    assert.ok(!codes.includes('static_telop_text_outside'));
    assert.ok(check(deepMerge(config, { telops: { serif: { marginV: -0.1 } } })).includes('static_telop_text_outside'));
    assert.ok(check(deepMerge(config, { telops: { title: { enabled: true, text: '題', box: { enabled: false }, align: 'bottom-center', marginV: 0.23 } } })).includes('static_telop_collision'));
  });
});
