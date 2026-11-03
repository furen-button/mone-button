import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

// CLI は Vite を通らないので同じ優先順位を明示する。空文字の環境変数も上書きとして扱う。
export function loadEnv(root, processEnv = process.env) {
  const read = (name) => {
    try {
      return parseEnv(fs.readFileSync(path.join(root, name), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  };
  return { ...read('.env'), ...read('.env.local'), ...processEnv };
}

// 対象行以外の改行・コメント・空白をそのまま保つ。token を戻り値やログに含めない。
export function saveLogin(root, { refreshToken, channelId, expectedChannelId }) {
  if (!refreshToken || !channelId || (expectedChannelId && expectedChannelId !== channelId)) {
    throw new Error('認証情報または上げ先チャンネルが一致しません。保存しません。');
  }
  const file = path.join(root, '.env.local');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const update = (key, value) => {
    if (/[\r\n"\\]/u.test(value)) {
      throw new Error('認証情報の形式が不正です。');
    }
    const line = `${key}="${value}"`;
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[^\\r\\n]*`, 'gm');
    if (pattern.test(text)) {
      text = text.replace(pattern, () => line);
    } else {
      text += `${text && !text.endsWith('\n') ? newline : ''}${line}${newline}`;
    }
  };
  update('YOUTUBE_REFRESH_TOKEN', refreshToken);
  if (!expectedChannelId) {
    update('YOUTUBE_CHANNEL_ID', channelId);
  }
  const temp = `${file}.tmp`;
  try {
    fs.writeFileSync(temp, text, { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
