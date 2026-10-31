// クリップの「要対応」判定。dev サイトのカードのバッジ・DEV ツールバー・編集モーダル・
// 保存時の review の正規化で同じ規則を使うため 1 か所にまとめる。
// ブラウザからも import するので Node の API に依存しない。

// serif の半角スペース無しで続く区間の上限（字数。半角は 0.5 字）。
// 動画のセリフは 1 行が埋まると直前の半角スペースで折り返す（scripts/create-video/ass.js の wrapText）。
// 字数は config-kirinuki のセリフ（1080p・既定の文字サイズ）で 15。ほかのプリセットは 18。
export const MAX_RUN_UNITS = 15;

// youtube-clip-tool の「現在位置 ±15 秒を範囲にする」で作った取り込み窓の長さ。
// この長さのまま trimming.original が無いクリップは、波形で切っていないとみなす。
export const IMPORT_WINDOW_SECONDS = 30;
const IMPORT_WINDOW_TOLERANCE_SECONDS = 0.05;

// 表示順。video は再生できないので先頭。
export const ISSUE_KINDS = Object.freeze(['video', 'trim', 'ruby', 'serif']);
export const ISSUE_LABELS = Object.freeze({
  video: '未DL',
  trim: '未カット',
  ruby: 'ルビ',
  serif: '区切り',
});
export const ISSUE_ICONS = Object.freeze({
  video: '📥',
  trim: '✂️',
  ruby: '🔤',
  serif: '␣',
});
// 「このままで良い」を記録できる種類。video はファイルの有無なので記録できない。
export const ACKNOWLEDGEABLE_KINDS = Object.freeze(['trim', 'ruby', 'serif']);

// scripts/create-video/ass.js の charWidth と同じ規則（半角は 0.5 字）。
export function charWidth(ch) {
  const code = ch.codePointAt(0) ?? 0;
  if (code <= 0x2ff) {
    return 0.5;
  }
  if (code >= 0xff61 && code <= 0xff9f) {
    return 0.5;
  }
  return 1;
}

// ass.js の makeTextElement と同じ順序で、stripEmoji → parseEmphasis の plain を作る。
// ass.js は Node 依存があるので規則を複製する。空白の整理も stripEmoji に合わせる。
export function serifPreviewText(text) {
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    // 異体字セレクタ・ZWJ・肌色修飾子。文字クラスに結合文字を並べると lint が誤読を警告するので選択で書く。
    .replace(/\uFE0F|\u200D|[\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/[^\S\r\n]*\r?\n[^\S\r\n]*/g, '\n')
    .trim()
    .replace(/\{([^{}|]+)(?:\|[0-9A-Fa-f]{6})?\}/g, '$1');
}

export function runUnits(run) {
  return [...run].reduce((sum, ch) => sum + charWidth(ch), 0);
}

export function formatUnits(units) {
  return Number.isInteger(units) ? String(units) : units.toFixed(1);
}

// 半角スペースと改行を区切りとして分けたトークン列。区切り自体もトークンとして残す（描画用）。
export function splitSerifTokens(serif) {
  return serifPreviewText(serif).split(/( |\r?\n)/);
}

export function isSerifSeparator(token) {
  return token === ' ' || /^\r?\n$/.test(token);
}

// 半角スペース無しで MAX_RUN_UNITS を超える区間。動画では語の途中で折り返される。
export function findLongSerifRuns(serif) {
  return splitSerifTokens(serif)
    .filter((token) => token !== '' && !isSerifSeparator(token))
    .map((token) => ({ text: token, units: runUnits(token) }))
    .filter((run) => run.units > MAX_RUN_UNITS);
}

// serif の半角 ! ? 。全角の文に混ざると細く詰まって見えるので、編集モーダルで強調し全角にできるようにする。
const HALFWIDTH_PUNCTUATION = /[!?]/g;
const FULLWIDTH_PUNCTUATION = { '!': '！', '?': '？' };

export function countHalfwidthPunctuation(serif) {
  return (serif.match(HALFWIDTH_PUNCTUATION) ?? []).length;
}

export function toFullwidthPunctuation(serif) {
  return serif.replace(HALFWIDTH_PUNCTUATION, (ch) => FULLWIDTH_PUNCTUATION[ch]);
}

// ruby は読み順の並び替えキー。toRuby（transcribe.js）が出力する字種だけを正とする:
// ひらがな（ゝゞ を含む）・長音・数字・英字。カタカナ・半角カナ・漢字・記号は要対応。
const RUBY_ALLOWED_CHAR = /^[\u3041-\u3096\u309D\u309E\u30FC\p{Number}\p{Script=Latin}]$/u;

export function findInvalidRubyChars(ruby) {
  const invalid = [];
  for (const ch of ruby) {
    if (!RUBY_ALLOWED_CHAR.test(ch) && !invalid.includes(ch)) {
      invalid.push(ch);
    }
  }
  return invalid;
}

// 取り込み時の窓（30 秒）のままで、まだ波形で切っていないクリップか。
// 波形トリム（trim.js）は必ず trimming.original を残すので、original があれば切ってある。
// youtube-clip-tool 側で手で範囲を決めたクリップは 30 秒ちょうどにならないので対象外になる。
export function isUntrimmedImportWindow(data) {
  const trimming = isPlainObject(data) && isPlainObject(data.trimming) ? data.trimming : null;
  if (!trimming || typeof trimming.duration !== 'number' || !Number.isFinite(trimming.duration)) {
    return false;
  }
  if (isPlainObject(trimming.original)) {
    return false;
  }
  return Math.abs(trimming.duration - IMPORT_WINDOW_SECONDS) < IMPORT_WINDOW_TOLERANCE_SECONDS;
}

// JSON の review を今のデータに照らして整える。確認したときの値と今の値が違えば確認は無効（落とす）。
// trim の確認は切っていない間だけ意味があるので、切ったあとは落とす。何も残らなければ undefined。
export function normalizeReview(review, data) {
  if (!isPlainObject(review)) {
    return undefined;
  }
  const next = {};
  if (review.trim === true && isUntrimmedImportWindow(data)) {
    next.trim = true;
  }
  const ruby = isPlainObject(data) && typeof data.ruby === 'string' ? data.ruby : undefined;
  if (typeof review.ruby === 'string' && review.ruby === ruby) {
    next.ruby = review.ruby;
  }
  const serif = isPlainObject(data) && typeof data.serif === 'string' ? data.serif : undefined;
  if (typeof review.serif === 'string' && review.serif === serif) {
    next.serif = review.serif;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

// 1 クリップの要対応と、「このままで良い」で消した種類。serif は JSON の生の値（改行・強調記法入り）を渡す。
// hasVideo が undefined（まだ確認できていない）のときは動画の有無を判定しない。
export function reviewClip(data, { hasVideo } = {}) {
  const review = isPlainObject(data) && isPlainObject(data.review) ? data.review : {};
  const issues = [];
  const acknowledged = [];

  if (hasVideo === false) {
    issues.push({
      kind: 'video',
      message: 'public/videos に mp4 がありません。npm run download で取得してください。',
    });
  }

  if (isUntrimmedImportWindow(data)) {
    if (review.trim === true) {
      acknowledged.push('trim');
    } else {
      issues.push({
        kind: 'trim',
        message: `取り込み時の ${IMPORT_WINDOW_SECONDS} 秒の窓のままです。波形で範囲を選んで「この範囲で切る」を押してください。`,
      });
    }
  }

  const ruby = isPlainObject(data) && typeof data.ruby === 'string' ? data.ruby : '';
  const invalidRubyChars = findInvalidRubyChars(ruby);
  if (ruby === '' || invalidRubyChars.length > 0) {
    if (review.ruby === ruby) {
      acknowledged.push('ruby');
    } else {
      issues.push({
        kind: 'ruby',
        message: ruby === ''
          ? 'ruby が空です。「serif から読みを作る」で生成してください。'
          : `ruby にひらがな・長音・数字・英字以外の文字があります: ${invalidRubyChars.join(' ')}`,
      });
    }
  }

  const serif = isPlainObject(data) && typeof data.serif === 'string' ? data.serif : '';
  const longRuns = findLongSerifRuns(serif);
  if (longRuns.length > 0) {
    if (review.serif === serif) {
      acknowledged.push('serif');
    } else {
      issues.push({
        kind: 'serif',
        message: `半角スペース無しで ${MAX_RUN_UNITS} 字を超える区間があります（${longRuns.map((run) => `${formatUnits(run.units)} 字`).join('・')}）。動画では語の途中で折り返されます。`,
      });
    }
  }

  return { issues, acknowledged };
}

// 一覧の件数。total は要対応が 1 つ以上あるクリップ数、counts は種類ごとの件数。
export function summarizeReviews(reviews) {
  const counts = { video: 0, trim: 0, ruby: 0, serif: 0 };
  let total = 0;
  for (const result of reviews) {
    if (result.issues.length > 0) {
      total += 1;
    }
    for (const issue of result.issues) {
      counts[issue.kind] += 1;
    }
  }
  return { total, counts };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
