// headless Chrome を CDP（Chrome DevTools Protocol）で操作する最小クライアント。
// 依存を増やさないため、Node 22 以降の組み込み WebSocket だけで話す。
//
// `--screenshot` フラグを使わないのは、あれが「読み込みが落ち着いた」と Chrome が判断した
// 瞬間に 1 枚撮って終わりで、その後に届く fetch の結果（クリップ一覧など）が写らないため。
// CDP なら load 後に待ってから、ページ全体の高さで撮れる。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const PORT_FILE = 'DevToolsActivePort';

export async function launchChrome({ chrome, width, height, timeoutMs = 30000 }) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mone-shots-'));
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] });

  const endpoint = await waitForEndpoint(profileDir, timeoutMs);
  const browser = await connect(endpoint);
  return {
    browser,
    async close() {
      try {
        await browser.send('Browser.close', {}, 2000);
      } catch {
        // 応答を待てなくてもプロセスごと落とす
      }
      browser.socket.close();
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // すでに終わっている
      }
      setTimeout(() => fs.rmSync(profileDir, { recursive: true, force: true }), 200);
    },
  };
}

async function waitForEndpoint(profileDir, timeoutMs) {
  const file = path.join(profileDir, PORT_FILE);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const [port, browserPath] = fs.readFileSync(file, 'utf8').split('\n');
      if (port && browserPath) {
        return `ws://127.0.0.1:${port}${browserPath}`;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome の DevTools エンドポイントが ${timeoutMs} ms 以内に開かない`);
}

// 1 本の WebSocket 上で、sessionId を付け替えて browser / page 両方のドメインを扱う。
function connect(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const pending = new Map();
    const listeners = new Set();
    let nextId = 1;

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve: done, reject: fail, timer } = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) {
          fail(new Error(`${message.error.message}（${message.error.code}）`));
        } else {
          done(message.result);
        }
        return;
      }
      for (const listener of listeners) {
        listener(message);
      }
    });
    socket.addEventListener('error', () => reject(new Error('DevTools への接続に失敗した')));
    socket.addEventListener('open', () => {
      resolve({
        socket,
        on(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        send(method, params = {}, timeoutMs = 30000, sessionId = undefined) {
          const id = nextId++;
          return new Promise((done, fail) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              fail(new Error(`${method} が ${timeoutMs} ms 以内に返らない`));
            }, timeoutMs);
            pending.set(id, { resolve: done, reject: fail, timer });
            socket.send(JSON.stringify({ id, method, params, sessionId }));
          });
        },
      });
    });
  });
}

// 1 ページ開いて撮る。settleMs は load 後に待つ時間（fetch の結果が描かれるのを待つ）。
export async function capturePage({ browser, url, width, height, settleMs, timeoutMs, fullPage = true }) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const messages = [];

  const off = browser.on((message) => {
    if (message.sessionId !== sessionId) {
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params.args || []).map(describe).join(' ');
      messages.push({ level: message.params.type, text });
    } else if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      messages.push({ level: 'error', text: details.exception?.description || details.text });
    } else if (message.method === 'Log.entryAdded') {
      const entry = message.params.entry;
      messages.push({ level: entry.level, text: entry.url ? `${entry.text} — ${entry.url}` : entry.text });
    }
  });

  try {
    await browser.send('Page.enable', {}, timeoutMs, sessionId);
    // ウィンドウサイズではなくエミュレーションで決める（Target.createTarget のサイズ指定は
    // 新規ウィンドウにしか効かない）。
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    }, timeoutMs, sessionId);
    await browser.send('Runtime.enable', {}, timeoutMs, sessionId);
    await browser.send('Log.enable', {}, timeoutMs, sessionId);

    const loaded = waitForEvent(browser, sessionId, 'Page.loadEventFired', timeoutMs);
    await browser.send('Page.navigate', { url }, timeoutMs, sessionId);
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, settleMs));

    let clip;
    if (fullPage) {
      const metrics = await browser.send('Page.getLayoutMetrics', {}, timeoutMs, sessionId);
      const content = metrics.cssContentSize || metrics.contentSize;
      clip = { x: 0, y: 0, width, height: Math.max(height, Math.ceil(content.height)), scale: 1 };
    }
    const shot = await browser.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: fullPage,
      ...(clip ? { clip } : {}),
    }, timeoutMs, sessionId);

    return { data: Buffer.from(shot.data, 'base64'), messages };
  } finally {
    off();
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

function waitForEvent(browser, sessionId, method, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`${method} が ${timeoutMs} ms 以内に来ない`));
    }, timeoutMs);
    const off = browser.on((message) => {
      if (message.sessionId === sessionId && message.method === method) {
        clearTimeout(timer);
        off();
        resolve(message.params);
      }
    });
  });
}

function describe(arg) {
  if (arg.type === 'string') {
    return arg.value;
  }
  if ('value' in arg) {
    return JSON.stringify(arg.value);
  }
  return arg.description || arg.className || arg.type;
}
