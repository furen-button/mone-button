import { optionalAsset } from './assets.js';
import { AUDIO_RESAMPLE } from './ffmpeg.js';

// クリップ同士の繋ぎ目に入れるトランジション。今は whip（横モーションブラーのホイップパン）だけ。
//
// 出る側は自分のセグメントの末尾 half 秒で加速しながら左へ流れ、横ブラーが最大になった瞬間に終わる。
// 入る側は自分のセグメントの先頭 half 秒で右から流れ込み、減速しながらブラーが消えて止まる。
// 切り替わりはブラーが最大の瞬間なので、2 本を素のカットで繋いでも継ぎ目は見えない。
// 各セグメントの中で完結させるため、concat-vcopy・manifest の実尺・summary の時刻・still の共有経路は変わらない。
// テロップ（帯・セリフ）は焼き込み後に流すので、画面ごと一緒に流れる。

// クリップ i の前後にトランジションを入れるか。mode は stream（配信が変わる所だけ）/ all / none。
// 区切りカードがあるとクリップ同士が隣り合わないので何も入れない。
export function planTransitions(clips, config) {
  const spec = config.transitions || {};
  const mode = spec.mode || 'none';
  const plans = clips.map(() => ({ in: false, out: false }));
  if (mode === 'none' || config.cards?.enabled) {
    return plans;
  }
  for (let i = 0; i + 1 < clips.length; i++) {
    if (mode === 'all' || clips[i].videoId !== clips[i + 1].videoId) {
      plans[i].out = true;
      plans[i + 1].in = true;
    }
  }
  return plans;
}

// 片側の長さ。短いクリップで入りと出が重ならないよう、クリップ尺の 1/3 を上限にする。
export function transitionHalf(config, duration) {
  const half = Math.max(0, Number(config.transitions?.duration ?? 0.5) / 2);
  return Number(Math.min(half, Math.max(0, Number(duration) || 0) / 3).toFixed(4));
}

// セグメント 1 本に掛けるトランジションの計画。何も入らなければ null。
export function planClipTransition({ side, config, duration, size }) {
  if (!side?.in && !side?.out) {
    return null;
  }
  const spec = config.transitions || {};
  const half = transitionHalf(config, duration);
  if (half <= 0) {
    return null;
  }
  return {
    type: spec.type || 'whip',
    in: side.in ? { start: 0, end: half } : null,
    out: side.out ? { start: Math.max(0, duration - half), end: duration } : null,
    half,
    duration,
    shift: Math.round(size.width * Number(spec.shift ?? 1)),
    blur: size.width * Number(spec.blur ?? 0.03),
    fps: size.fps,
    se: side.in ? transitionSe(config) : null,
  };
}

function transitionSe(config) {
  const se = config.transitions?.se;
  if (!se?.enabled || !se.file) {
    return null;
  }
  const file = optionalAsset(se.file, 'トランジション SE');
  return file ? { file, volume: Number(se.volume ?? 1) } : null;
}

// 焼き込み済みの映像に続ける whip のフィルタ列。-vf の末尾にそのまま ',' で繋げる形で返す
// （split / overlay の内部ラベルを持つが、入力 1 本・出力 1 本なので -vf でも filter_complex でも使える）。
export function whipFilterChain(plan, width) {
  if (!plan) {
    return '';
  }
  const parts = [];
  if (plan.in) {
    parts.push(shiftStage({ prefix: 'twi', window: plan.in, shift: plan.shift, width, entering: true }));
  }
  if (plan.out) {
    parts.push(shiftStage({ prefix: 'two', window: plan.out, shift: plan.shift, width, entering: false }));
  }
  const blurs = [
    ...(plan.in ? blurStages({ window: plan.in, plan, entering: true }) : []),
    ...(plan.out ? blurStages({ window: plan.out, plan, entering: false }) : []),
  ];
  return [...parts, ...blurs].join(',');
}

// 画面を横に繰り返して平行移動する。入力を 2 枚重ね、2 枚目を 1 画面ぶん右に置いて回り込ませる。
// 出る側は s = shift·p²（加速）、入る側は s = shift·(1−p)²（減速）だけ左へずれた絵を作る。
function shiftStage({ prefix, window, shift, width, entering }) {
  const span = fmt(window.end - window.start);
  const progress = `clip((t-${fmt(window.start)})/${span},0,1)`;
  const travel = entering ? `${shift}*pow(1-${progress},2)` : `${shift}*pow(${progress},2)`;
  // 入る側は右から来るので、左へのずれは「1 画面 − 残りの距離」になる。
  const offset = entering ? `mod(${width}-mod(${travel},${width}),${width})` : `mod(${travel},${width})`;
  const enable = entering ? `lt(t,${fmt(window.end)})` : `gte(t,${fmt(window.start)})`;
  return [
    `split=3[${prefix}0][${prefix}1][${prefix}2]`,
    `;[${prefix}0][${prefix}1]overlay=x='-(${offset})':y=0:eval=frame:enable='${enable}'[${prefix}3]`,
    `;[${prefix}3][${prefix}2]overlay=x='${width}-(${offset})':y=0:eval=frame:enable='${enable}'`,
  ].join('');
}

// 横ブラー。速さ（出る側 p、入る側 1−p）に比例した sigma を 1 フレームずつ掛ける。
// 窓の外側の端は開いておき、尺の見積もりが 1 フレームずれても最大ブラーのまま切り替わるようにする。
function blurStages({ window, plan, entering }) {
  const frame = 1 / plan.fps;
  const first = Math.ceil(window.start * plan.fps - 1e-6);
  const last = Math.floor(window.end * plan.fps - 1e-6);
  const stages = [];
  for (let k = first; k <= last; k++) {
    const t = k * frame;
    const p = Math.min(1, Math.max(0, (t - window.start) / (window.end - window.start)));
    const speed = entering ? 1 - p : p;
    const sigma = plan.blur * speed;
    if (sigma < 0.5) {
      continue;
    }
    const lo = entering && k === first ? null : fmt(t - frame / 2);
    const hi = !entering && k === last ? null : fmt(t + frame / 2);
    let enable;
    if (lo === null) {
      enable = `lt(t,${hi})`;
    } else if (hi === null) {
      enable = `gte(t,${lo})`;
    } else {
      enable = `between(t,${lo},${hi})`;
    }
    stages.push(`gblur=sigma=${fmt(sigma, 1)}:sigmaV=0:enable='${enable}'`);
  }
  return stages;
}

// 入る側の先頭（切り替わりの瞬間）に SE を重ねる音声グラフ。SE が無ければ null（従来の -af を使う）。
// クリップ音声は従来どおり AUDIO_RESAMPLE を通してから混ぜ、長さはクリップ音声に揃える（amix duration=first）。
export function transitionAudioGraph(plan, { audioIndex = 0, seIndex = 1 } = {}) {
  if (!plan?.se) {
    return null;
  }
  return [
    `[${audioIndex}:a]${AUDIO_RESAMPLE},aformat=sample_fmts=fltp:channel_layouts=stereo[tca]`,
    `[${seIndex}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${fmt(plan.se.volume, 3)}[tse]`,
    '[tca][tse]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]',
  ].join(';');
}

// manifest に残す形。
export function describeTransition(plan) {
  if (!plan) {
    return null;
  }
  return {
    type: plan.type,
    in: plan.in,
    out: plan.out,
    se: plan.se ? { file: plan.se.file, volume: plan.se.volume } : null,
  };
}

function fmt(value, digits = 4) {
  return Number(Number(value).toFixed(digits)).toString();
}
