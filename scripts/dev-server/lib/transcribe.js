import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import kuromoji from 'kuromoji';

const require = createRequire(import.meta.url);
let tokenizerPromise;

function getTokenizer() {
  tokenizerPromise ??= new Promise((resolve, reject) => {
    const dicPath = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
    kuromoji.builder({ dicPath }).build((error, tokenizer) => {
      if (error) reject(error);
      else resolve(tokenizer);
    });
  }).catch((error) => {
    tokenizerPromise = undefined;
    throw error;
  });
  return tokenizerPromise;
}

export async function toRuby(text) {
  const tokenizer = await getTokenizer();
  return tokenizer.tokenize(text).map((token) => {
    // 数字・英字は辞書に読みがあっても表層形を保持する。
    const reading = /[\p{Number}\p{Script=Latin}]/u.test(token.surface_form)
      ? token.surface_form
      : token.reading && token.reading !== '*' ? token.reading : token.surface_form;
    return reading.replace(/[ァ-ヶ]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
  }).join('').replace(/[\p{Punctuation}\p{Symbol}\p{Separator}\p{Other}\s]/gu, '');
}

// Whisper と音声抽出はプロセス内で 1 件ずつ実行する。失敗しても次の処理を止めない。
let transcribeQueue = Promise.resolve();

// モデルの置き場所は環境ごとに違うため既定値は持たず、WHISPER_MODEL_PATH を必須にする。
export function resolveWhisperConfig(env, repoRoot) {
  if (!env.WHISPER_MODEL_PATH) {
    throw new Error('WHISPER_MODEL_PATH が設定されていません。.env.local に Whisper モデル（ggml-*.bin）の絶対パスを設定し、dev サーバを再起動してください。');
  }
  const modelPath = path.resolve(repoRoot, env.WHISPER_MODEL_PATH);
  if (!existsSync(modelPath)) {
    throw new Error(`Whisper モデルが見つかりません: ${modelPath}。モデルを用意し、.env.local の WHISPER_MODEL_PATH にパスを設定してください。`);
  }
  return {
    cli: env.WHISPER_CLI || 'whisper-cli',
    modelPath,
    language: env.WHISPER_LANGUAGE || 'ja',
  };
}

export function buildWhisperArgs({ config, wavPath, outputPrefix }) {
  return [
    '-m', config.modelPath, '-l', config.language,
    '-nt', '-np', '-mc', '0', '-otxt', '-of', outputPrefix, '-f', wavPath,
  ];
}

export function cleanTranscript(raw) {
  return raw.replace(/\[_[^\]]*\]/gu, '').replace(/\s+/gu, ' ').trim();
}

function runFile(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function transcribeFile(options) {
  const result = transcribeQueue.then(() => transcribeNow(options));
  transcribeQueue = result.catch(() => {});
  return result;
}

async function transcribeNow({ ffmpeg, videoPath, config }) {
  const started = Date.now();
  const tempDir = await mkdtemp(path.join(tmpdir(), 'mone-transcribe-'));
  try {
    const wavPath = path.join(tempDir, 'audio.wav');
    const outputPrefix = path.join(tempDir, 'transcript');
    await runFile(ffmpeg, ['-nostdin', '-y', '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath]);
    try {
      await runFile(config.cli, buildWhisperArgs({ config, wavPath, outputPrefix }));
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('whisper-cli が見つかりません。インストールするか、.env.local の WHISPER_CLI に実行ファイルのパスを設定してください。');
      }
      if (error.killed) throw new Error('文字起こしがタイムアウトしました（上限120秒）。');
      throw error;
    }
    const raw = await readFile(`${outputPrefix}.txt`, 'utf8');
    const serif = cleanTranscript(raw);
    const ruby = await toRuby(serif);
    return { serif, ruby, raw, ms: Date.now() - started };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
