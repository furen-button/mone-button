// createVideo / qc の stdout 行を分類する。index.js は機械可読な進捗を出さないので、
// 絵文字付きの行（🎬 [i/N] 描画中: … / ✅ 完成: … / 🧪 QC: …）が唯一の進捗源になる。

const ANSI_PATTERN = /\[[0-9;]*[A-Za-z]/gu;

export function stripAnsi(text) {
  return String(text).replace(ANSI_PATTERN, '');
}

// チャンク境界で割れた行を繋ぎ直す。stdout は任意の位置で分割されて届く。
export function createLineSplitter(onLine) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += String(chunk);
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/u, '');
        buffer = buffer.slice(index + 1);
        onLine(line);
        index = buffer.indexOf('\n');
      }
    },
    flush() {
      if (buffer.length > 0) {
        onLine(buffer.replace(/\r$/u, ''));
        buffer = '';
      }
    },
  };
}

export function parseLogLine(rawLine) {
  const line = stripAnsi(rawLine).trimEnd();
  let match = /^🎬 \[(\d+)\/(\d+)\] 描画中: (.+)$/u.exec(line);
  if (match) {
    return { kind: 'progress', i: Number(match[1]), n: Number(match[2]), base: match[3].trim() };
  }
  if (/^🚀 /u.test(line)) {
    return { kind: 'stage', name: 'render' };
  }
  if (/^🔗 /u.test(line)) {
    return { kind: 'stage', name: 'concat' };
  }
  if (/^🎧 /u.test(line)) {
    return { kind: 'stage', name: 'bgm' };
  }
  match = /^✅ 完成: (.+)$/u.exec(line);
  if (match) {
    return { kind: 'done', outPath: match[1].trim() };
  }
  match = /^\s+concat: (\S+)$/u.exec(line);
  if (match) {
    return { kind: 'concat', method: match[1] };
  }
  match = /^🧾 (.+)$/u.exec(line);
  if (match) {
    return { kind: 'sidecar', stage: 'manifest', path: match[1].trim() };
  }
  match = /^📝 (.+)$/u.exec(line);
  if (match) {
    return { kind: 'sidecar', stage: 'summary', path: match[1].trim() };
  }
  match = /^🧪 QC: error (\d+) \/ warn (\d+) \/ info (\d+)/u.exec(line);
  if (match) {
    return { kind: 'qc', error: Number(match[1]), warn: Number(match[2]), info: Number(match[3]) };
  }
  return null;
}
