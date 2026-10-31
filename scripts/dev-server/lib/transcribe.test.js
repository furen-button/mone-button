import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { toRuby, resolveWhisperConfig, buildWhisperArgs, cleanTranscript } from './transcribe.js';

test('toRuby: 実辞書で読みを生成し数字・英字・長音・小書き仮名を保持し、半角カナはひらがなにする', async () => {
  const cases = [
    ['恋愛スペシャリストって 呼ばれてるの', 'れんあいすぺしゃりすとってよばれてるの'],
    ['わぁ人がいっぱいいる', 'わぁひとがいっぱいいる'],
    ['1000年以上生きた 魔法使いなんですね', '1000ねんいじょういきたまほうつかいなんですね'],
    ['「スーパー！」 ABC 123（テスト）…★\n', 'すーぱーABC123てすと'],
    ['', ''],
    ['！？ （）★\t', ''],
    ['クォッピョー', 'くぉっぴょー'],
    // 半角カナは全角に揃えてからひらがなにする（濁点の合成・長音 ｰ・前後の語との混在）
    ['ｲｷﾞｬｰﾘ！', 'いぎゃーり'],
    ['朝からｲｷﾞｬｰﾘ！', 'あさからいぎゃーり'],
    [':_ノーマルもねゴン:ｲｷﾞｬｰﾘ', 'のーまるもねごんいぎゃーり'],
    ['ﾊﾟﾌｪ食べたい', 'ぱふぇたべたい'],
    ['ﾞ', ''],
  ];
  await Promise.all(cases.map(async ([text, expected]) => {
    assert.equal(await toRuby(text), expected, text);
  }));
});


test('resolveWhisperConfig: モデル必須、既定値、明示設定、相対パス、不在エラー', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'whisper-config-test-'));
  const root = path.join(dir, 'repo');
  const modelPath = path.join(dir, 'models/model.bin');
  try {
    mkdirSync(path.dirname(modelPath), { recursive: true });
    writeFileSync(modelPath, '');
    assert.throws(() => resolveWhisperConfig({}, root), /WHISPER_MODEL_PATH が設定されていません/u);
    assert.throws(() => resolveWhisperConfig({ WHISPER_MODEL_PATH: '' }, root), /WHISPER_MODEL_PATH が設定されていません/u);
    assert.deepEqual(resolveWhisperConfig({ WHISPER_MODEL_PATH: modelPath }, root), { cli: 'whisper-cli', modelPath, language: 'ja' });
    assert.deepEqual(resolveWhisperConfig({ WHISPER_CLI: '/custom/whisper', WHISPER_MODEL_PATH: modelPath, WHISPER_LANGUAGE: 'en' }, root), { cli: '/custom/whisper', modelPath, language: 'en' });
    assert.equal(resolveWhisperConfig({ WHISPER_MODEL_PATH: '../models/model.bin' }, root).modelPath, modelPath);
    assert.throws(() => resolveWhisperConfig({ WHISPER_MODEL_PATH: 'missing.bin' }, root), /モデルが見つかりません.*WHISPER_MODEL_PATH/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildWhisperArgs: 文脈ループ対策を含む固定引数（空白もそのまま渡す）', () => {
  assert.deepEqual(buildWhisperArgs({ config: { cli: 'whisper-cli', modelPath: '/model path.bin', language: 'ja' }, wavPath: '/audio path.wav', outputPrefix: '/output path' }), [
    '-m', '/model path.bin', '-l', 'ja', '-nt', '-np', '-mc', '0', '-otxt', '-of', '/output path', '-f', '/audio path.wav',
  ]);
});

test('cleanTranscript: 特殊トークンを除去し、改行と空白を1つにまとめる', () => {
  assert.equal(cleanTranscript('  [_BEG_]こんにちは[_TT_123]\r\n\n 世界\tです  [_EOT_] '), 'こんにちは 世界 です');
  assert.equal(cleanTranscript('[_TT_123]\n'), '');
  assert.equal(cleanTranscript('「通常の[括弧]」'), '「通常の[括弧]」');
});
