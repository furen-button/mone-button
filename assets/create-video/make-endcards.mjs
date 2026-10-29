// 肉球の背景動画 + ジングルで 10 秒のエンドカードを、アニメーション違いで書き出す。
// 枠とラベルは config-kirinuki の ED（`npm run still -- --still ending --print-ass`）の ASS をそのまま土台にし、
// 動きはフレームごとの Dialogue で付ける（\pos の移動と、中心基準の拡大を正確に出すため）。
//
// usage（リポジトリのルートで）:
//   node assets/create-video/make-endcards.mjs
//   node assets/create-video/make-endcards.mjs --pattern 04-pop --bg-speed 0.75,0.5,0.35
//
// options:
//   --pattern <name,...>   01-static / 02-fade / 03-draw / 04-pop / 05-slide / 06-drop（既定 全部）
//   --bg-speed <n,...>     背景の再生速度。1 以外は名前に -bg050 などを付ける（既定 1）
//   --color <RRGGBB>       背景の置き換え先の色（既定 FFC6E2）
//   --src-color <RRGGBB>   背景素材の地の色（既定 FEDB3B = 5bg025肉球.mp4 の黄色）
//   --bg <path>            背景動画（既定 assets/create-video/5bg025肉球.mp4）
//   --audio <path>         ジングル（既定 assets/create-video/sake ni nomareru/sake ni nomareru1.mp3）
//   --config <path>        枠とラベルを取るプリセット（既定 scripts/create-video/config-kirinuki.json）
//   --out-dir <path>       出力先（既定 output/endcard）
//
// 素材（どちらも gitignore 済みなので各自で取得して置く）:
//   背景 5bg025肉球.mp4: 「Youtuberのための動画素材屋さん」の「肉球」（1920x1080 / 30 秒 / ループ対応）
//     https://ytsozaiyasan.com/download/5bg025
//     規約 https://ytsozaiyasan.com/terms … クレジット表記は不要、加工は可。素材単体の公開とコンテンツ ID 登録は禁止
//   ジングル sake ni nomareru/sake ni nomareru1.mp3: OtoLogic のジングル（mid1）
//     https://otologic.jp/free/jing/mid1.html
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeFilterPath } from '../../scripts/create-video/ass.js';
import { resolveFfmpeg } from '../../scripts/create-video/ffmpeg.js';
import { readEndcardAss } from '../../scripts/create-video/endcard-ass.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const W = 1920;
const H = 1080;
const FPS = 30;
const DURATION = 10;
const TARGET_LUFS = -23;
const T0 = 0.3; // ジングルが鳴り始める時刻

function parseArgs(argv) {
  const opts = {
    pattern: null,
    bgSpeed: '1',
    color: 'FFC6E2',
    srcColor: 'FEDB3B',
    bg: 'assets/create-video/5bg025肉球.mp4',
    audio: 'assets/create-video/sake ni nomareru/sake ni nomareru1.mp3',
    config: 'scripts/create-video/config-kirinuki.json',
    outDir: 'output/endcard',
  };
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) {
      throw new Error(`不明な引数です: ${argv[i]}`);
    }
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in opts)) {
      throw new Error(`不明なオプションです: --${m[1]}`);
    }
    opts[key] = m[2] ?? argv[++i];
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const fromRoot = (p) => path.resolve(ROOT, p);
const { ffmpeg: FF } = resolveFfmpeg();
const outDir = fromRoot(opts.outDir);
fs.mkdirSync(outDir, { recursive: true });

// ---- 色: 地の色 → 指定色の 3x3 線形変換（白・黒は不動なので半透明の肉球も崩れない） ----
function recolorMixer(from, to) {
  const hx = (s) => [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  const Y = hx(from);
  const P = hx(to);
  const m = (Y[0] + Y[1] + Y[2]) / 3;
  let u = Y.map((y) => y - m);
  const k = u.reduce((a, x, i) => a + x * Y[i], 0);
  u = u.map((x) => x / k);
  const d = P.map((p, i) => p - Y[i]);
  const n = ['r', 'g', 'b'];
  const parts = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      parts.push(`${n[i]}${n[j]}=${((i === j ? 1 : 0) + d[i] * u[j]).toFixed(5)}`);
    }
  }
  return parts.join(':');
}

// ---- 土台の ASS（プリセットの ED を still で書き出したもの） ----
const assText = readEndcardAss(fromRoot(opts.config), outDir);
const header = assText.slice(0, assText.indexOf('Dialogue:'));
const events = assText.split('\n').filter((l) => l.startsWith('Dialogue:')).map((line) => {
  const [, layer, style, text] = line.match(/^Dialogue: (\d+),[^,]*,[^,]*,([^,]*),[^,]*,\d+,\d+,\d+,[^,]*,(.*)$/);
  const pos = text.match(/\\pos\(([-\d.]+),([-\d.]+)\)/);
  const shape = text.match(/\\p1.*?\}m 0 0 l (\d+) 0 \1 (\d+) 0 \2/);
  return {
    layer: Number(layer),
    style,
    text,
    x: Number(pos[1]),
    y: Number(pos[2]),
    kind: shape ? 'line' : 'label',
    w: shape ? Number(shape[1]) : null,
    h: shape ? Number(shape[2]) : null,
  };
});
const lines = events.filter((e) => e.kind === 'line');
const [topLabel, bottomLabel] = events.filter((e) => e.kind === 'label').sort((a, b) => a.y - b.y);

// ラベルの実際の外接矩形を libass で描いて測る（中心基準の拡大・画面外からの移動に使う）。
// cropdetect は 1 行の平均の明るさで判定するので細い文字は拾えない。bbox を使う。
function measure(ev) {
  const tmp = path.join(outDir, `.measure-${process.pid}.ass`);
  fs.writeFileSync(tmp, `${header}Dialogue: ${ev.layer},0:00:00.00,0:00:01.00,${ev.style},,0,0,0,,${ev.text}\n`);
  const r = spawnSync(FF, ['-hide_banner', '-f', 'lavfi', '-i', `color=black:s=${W}x${H}:r=${FPS}:d=0.2`,
    '-vf', `subtitles=filename='${escapeFilterPath(tmp)}',bbox=min_val=24`, '-f', 'null', '-'], { encoding: 'utf8' });
  fs.rmSync(tmp);
  const m = [...r.stderr.matchAll(/x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/g)].at(-1);
  if (!m) {
    throw new Error(`ラベルの外接矩形を測れませんでした:\n${r.stderr}`);
  }
  const [x1, x2, y1, y2] = m.slice(1).map(Number);
  const w = x2 - x1 + 1;
  const h = y2 - y1 + 1;
  return { x: x1, y: y1, w, h, cx: x1 + w / 2, cy: y1 + h / 2 };
}
topLabel.box = measure(topLabel);
bottomLabel.box = measure(bottomLabel);
const frameCenter = {
  cx: (Math.min(...lines.map((l) => l.x)) + Math.max(...lines.map((l) => l.x + l.w))) / 2,
  cy: (Math.min(...lines.map((l) => l.y)) + Math.max(...lines.map((l) => l.y + l.h))) / 2,
};

// ---- イージング ----
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = {
  linear: (x) => x,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  outBack: (x) => {
    const c1 = 1.9;
    const c3 = c1 + 1;
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
  },
  outBounce: (x) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (x < 1 / d1) {
      return n1 * x * x;
    }
    if (x < 2 / d1) {
      x -= 1.5 / d1;
      return n1 * x * x + 0.75;
    }
    if (x < 2.5 / d1) {
      x -= 2.25 / d1;
      return n1 * x * x + 0.9375;
    }
    x -= 2.625 / d1;
    return n1 * x * x + 0.984375;
  },
};
const progress = (t, t0, t1, fn = ease.linear) => fn(clamp01((t - t0) / (t1 - t0)));

// ---- 枠を一筆で描く順路（左上の角から時計回り。ラベルの切れ目も同じ速さで通る） ----
// 各線を「どの端から伸ばすか」を決め、順路上の開始距離を持たせる。
function buildPath() {
  const minX = Math.min(...lines.map((l) => l.x));
  const maxX = Math.max(...lines.map((l) => l.x + l.w));
  const minY = Math.min(...lines.map((l) => l.y));
  const horiz = lines.filter((l) => l.w > l.h);
  const vert = lines.filter((l) => l.h > l.w);
  const top = horiz.filter((l) => l.y === minY).sort((a, b) => a.x - b.x);
  const bottom = horiz.filter((l) => l.y !== minY).sort((a, b) => b.x - a.x);
  const right = vert.find((l) => l.x + l.w === maxX);
  const left = vert.find((l) => l.x === minX);
  const seq = [];
  let d = 0;
  let cursor = minX;
  for (const l of top) {
    d += l.x - cursor;
    seq.push({ l, start: d, len: l.w, dir: 'right' });
    d += l.w;
    cursor = l.x + l.w;
  }
  d += maxX - cursor;
  seq.push({ l: right, start: d - right.w, len: right.h, dir: 'down' });
  d += right.h - right.w;
  cursor = maxX;
  for (const l of bottom) {
    d += cursor - (l.x + l.w);
    seq.push({ l, start: d, len: l.w, dir: 'left' });
    d += l.w;
    cursor = l.x;
  }
  d += cursor - minX;
  seq.push({ l: left, start: d - left.w, len: left.h, dir: 'up' });
  d += left.h - left.w;
  // ラベルの切れ目に筆が入る距離（切れ目の手前にある線の終点）
  const gapAt = (row) => {
    const s = seq.find((p) => p.l === row[0]);
    return s.start + s.len;
  };
  return { seq, total: d, topGap: gapAt(top), bottomGap: gapAt(bottom) };
}
const drawPath = buildPath();
const DRAW_DURATION = 1.3;

function clipFor(p, drawn) {
  const v = Math.min(p.len, Math.max(0, drawn - p.start));
  if (v <= 0) {
    return null;
  }
  const { l } = p;
  const pad = 2;
  switch (p.dir) {
    case 'right':
      return [l.x - pad, l.y - pad, l.x + v, l.y + l.h + pad];
    case 'left':
      return [l.x + l.w - v, l.y - pad, l.x + l.w + pad, l.y + l.h + pad];
    case 'down':
      return [l.x - pad, l.y - pad, l.x + l.w + pad, l.y + v];
    default:
      return [l.x - pad, l.y + l.h - v, l.x + l.w + pad, l.y + l.h + pad];
  }
}

function drawTimeOf(distance) {
  // inOutCubic の逆関数を二分探索で求める
  const target = distance / drawPath.total;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ease.inOutCubic(mid) < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return T0 + DRAW_DURATION * lo;
}

function labelPopAt(t, t0) {
  if (t < t0) {
    return null;
  }
  const k = progress(t, t0, t0 + 0.3, ease.outBack);
  return { ...SHOW, a: progress(t, t0, t0 + 0.12), s: 0.6 + 0.4 * k };
}

function bounceIn(t, t0, dur) {
  if (t < t0) {
    return null;
  }
  return { ...SHOW, a: progress(t, t0, t0 + dur * 0.25), s: Math.max(0, progress(t, t0, t0 + dur, ease.outBack)) };
}

// ---- パターン：各要素の t における状態 {a: 不透明度, s: 拡大率, dx, dy, clip} ----
// 戻り値 null は非表示。settle は以降ずっと最終状態になる時刻。
const SHOW = { a: 1, s: 1, dx: 0, dy: 0 };
const PATTERNS = {
  '01-static': {
    title: '静止（今の kirinuki の ED と同じ）',
    settle: 0,
    frame: () => SHOW,
    top: () => SHOW,
    bottom: () => SHOW,
  },
  '02-fade': {
    title: 'ふわっとフェードイン',
    settle: T0 + 0.6,
    frame: (t) => ({ ...SHOW, a: progress(t, T0, T0 + 0.6, ease.outCubic) }),
    top: (t) => ({ ...SHOW, a: progress(t, T0, T0 + 0.6, ease.outCubic) }),
    bottom: (t) => ({ ...SHOW, a: progress(t, T0, T0 + 0.6, ease.outCubic) }),
  },
  '03-draw': {
    title: '枠を一筆書きで描き、通り過ぎた所でラベルが出る',
    settle: T0 + 1.6,
    frame: (t, line) => {
      const drawn = progress(t, T0, T0 + DRAW_DURATION, ease.inOutCubic) * drawPath.total;
      const p = drawPath.seq.find((q) => q.l === line);
      const clip = clipFor(p, drawn);
      if (!clip) {
        return null;
      }
      return { ...SHOW, clip: drawn >= p.start + p.len ? null : clip };
    },
    top: (t) => labelPopAt(t, drawTimeOf(drawPath.topGap)),
    bottom: (t) => labelPopAt(t, drawTimeOf(drawPath.bottomGap)),
  },
  '04-pop': {
    title: '枠が寄ってきて、ラベルが弾んで出る',
    settle: T0 + 1.2,
    frame: (t) => {
      const k = progress(t, T0, T0 + 0.5, ease.outCubic);
      return { ...SHOW, a: k, s: 1.06 - 0.06 * k };
    },
    top: (t) => bounceIn(t, T0 + 0.3, 0.45),
    bottom: (t) => bounceIn(t, T0 + 0.55, 0.45),
  },
  '05-slide': {
    title: 'ラベルが左右から滑り込む',
    settle: T0 + 1.1,
    frame: (t) => ({ ...SHOW, a: progress(t, T0, T0 + 0.4, ease.outCubic) }),
    top: (t) => {
      const k = progress(t, T0 + 0.2, T0 + 0.8, ease.outCubic);
      return { ...SHOW, dx: -(topLabel.box.x + topLabel.box.w + 40) * (1 - k) };
    },
    bottom: (t) => {
      const k = progress(t, T0 + 0.45, T0 + 1.05, ease.outCubic);
      return { ...SHOW, dx: (W - bottomLabel.box.x + 40) * (1 - k) };
    },
  },
  '06-drop': {
    title: 'ラベルが上下から飛び込んでバウンドする',
    settle: T0 + 1.3,
    frame: (t) => ({ ...SHOW, a: progress(t, T0, T0 + 0.4, ease.outCubic) }),
    top: (t) => {
      const k = progress(t, T0 + 0.15, T0 + 0.85, ease.outBounce);
      return { ...SHOW, dy: -(topLabel.box.y + topLabel.box.h + 40) * (1 - k) };
    },
    bottom: (t) => {
      const k = progress(t, T0 + 0.5, T0 + 1.2, ease.outBounce);
      return { ...SHOW, dy: (H - bottomLabel.box.y + 40) * (1 - k) };
    },
  },
};

// ---- ASS の組み立て ----
function ts(sec) {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
const r2 = (v) => Math.round(v * 100) / 100;

function renderEvent(ev, center, st) {
  if (!st || st.a <= 0.001 || st.s <= 0.001) {
    return null;
  }
  // libass は配置点（\an の基準点）を中心に拡大するので、中心 c を保つよう配置点を c + s(p − c) へずらす
  const x = center.cx + st.s * (ev.x - center.cx) + st.dx;
  const y = center.cy + st.s * (ev.y - center.cy) + st.dy;
  let text = ev.text.replace(/\\pos\([^)]*\)/, `\\pos(${r2(x)},${r2(y)})`);
  const extra = [];
  if (st.s !== 1) {
    extra.push(`\\fscx${r2(st.s * 100)}\\fscy${r2(st.s * 100)}`);
  }
  if (st.a < 1) {
    extra.push(`\\alpha&H${Math.round((1 - st.a) * 255).toString(16).padStart(2, '0').toUpperCase()}&`);
  }
  if (st.clip) {
    extra.push(`\\clip(${st.clip.map(Math.round).join(',')})`);
  }
  if (extra.length) {
    text = text.replace(/^\{/, `{${extra.join('')}`);
  }
  return text;
}

// 動いている間は 1 フレーム 1 イベントにする。フレーム k は [(k−0.5)/fps, (k+0.5)/fps) に置き、
// センチ秒への丸めでも隣と重ならず、フレーム時刻が必ず内側に入るようにする。
function buildAss(pat) {
  const out = [];
  const elements = [
    ...lines.map((l) => ({ ev: l, center: frameCenter, state: (t) => pat.frame(t, l) })),
    { ev: topLabel, center: topLabel.box, state: pat.top },
    { ev: bottomLabel, center: bottomLabel.box, state: pat.bottom },
  ];
  const settleFrame = Math.ceil(pat.settle * FPS);
  for (const el of elements) {
    for (let k = 0; k < settleFrame; k++) {
      const text = renderEvent(el.ev, el.center, el.state(k / FPS));
      if (!text) {
        continue;
      }
      const start = k === 0 ? 0 : (k - 0.5) / FPS;
      out.push(`Dialogue: ${el.ev.layer},${ts(start)},${ts((k + 0.5) / FPS)},${el.ev.style},,0,0,0,,${text}`);
    }
    const text = renderEvent(el.ev, el.center, el.state(DURATION));
    const start = settleFrame === 0 ? 0 : (settleFrame - 0.5) / FPS;
    out.push(`Dialogue: ${el.ev.layer},${ts(start)},${ts(DURATION + 1)},${el.ev.style},,0,0,0,,${text}`);
  }
  return `${header}${out.join('\n')}\n`;
}

// ---- 音量：ジングルを TARGET_LUFS に合わせる ----
function integratedLufs(file) {
  const r = spawnSync(FF, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/Summary:[\s\S]*?I:\s*(-?[\d.]+) LUFS/);
  if (!m) {
    throw new Error(`ラウドネスを測れませんでした: ${file}\n${r.stderr}`);
  }
  return Number(m[1]);
}

// ---- 書き出し ----
const bgVideo = fromRoot(opts.bg);
const jingle = fromRoot(opts.audio);
const gainDb = TARGET_LUFS - integratedLufs(jingle);
const mixer = recolorMixer(opts.srcColor, opts.color);
const names = opts.pattern ? opts.pattern.split(',') : Object.keys(PATTERNS);
const speeds = opts.bgSpeed.split(',').map(Number);
for (const name of names) {
  const pat = PATTERNS[name];
  if (!pat) {
    throw new Error(`不明なパターンです: ${name}（${Object.keys(PATTERNS).join(' / ')}）`);
  }
  for (const speed of speeds) {
    const suffix = speed === 1 ? '' : `-bg${String(Math.round(speed * 100)).padStart(3, '0')}`;
    const assPath = path.join(outDir, `endcard-pink-${name}${suffix}.ass`);
    const outPath = path.join(outDir, `endcard-pink-${name}${suffix}.mp4`);
    fs.writeFileSync(assPath, buildAss(pat));
    const vf = [
      // 遅くするときは足りないコマを前後のコマを混ぜて補う（肉球はその場に現れて消えるだけで動かないので、混ぜても像がぶれない）
      ...(speed === 1 ? [] : [`setpts=(PTS-STARTPTS)/${speed}`, `framerate=fps=${FPS}`]),
      `trim=duration=${DURATION}`, 'setpts=PTS-STARTPTS',
      `scale=${W}:${H}:in_color_matrix=bt709:in_range=tv:out_range=pc`, 'format=gbrp',
      `colorchannelmixer=${mixer}`,
      `fps=${FPS}`,
      `subtitles=filename='${escapeFilterPath(assPath)}'`,
      'scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p',
    ].join(',');
    const af = `volume=${gainDb.toFixed(2)}dB,aresample=44100,aformat=channel_layouts=stereo,apad,atrim=duration=${DURATION}`;
    execFileSync(FF, ['-hide_banner', '-v', 'error', '-y',
      '-i', bgVideo, '-i', jingle,
      '-filter_complex', `[0:v]${vf}[v];[1:a]${af}[a]`,
      '-map', '[v]', '-map', '[a]', '-t', String(DURATION),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart',
      outPath], { stdio: 'inherit' });
    const shown = path.relative(ROOT, outPath).startsWith('..') ? outPath : path.relative(ROOT, outPath);
    console.log(`${shown}  ${pat.title}${speed === 1 ? '' : `（背景 ${speed} 倍速）`}`);
  }
}
