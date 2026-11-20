import path from 'path';

const trimmedSec = (clips) => clips.reduce((sum, clip) => sum + (clip.endTime - clip.startTime), 0);

// 選択・並び替え済みのクリップ列を、連続する同じ配信の塊に分ける（Shorts 用の output.split）。
// 塊の合計尺（トリム尺）が minSec に届くまで次の塊とまとめ、末尾だけ短く残ったら直前へ寄せる。
// targetSec があれば、塊を割らずに各パートの尺が targetSec に近くなる切り方を選ぶ（minSec 未満のパートは作らない）。
// 同じ配信が離れた位置で再登場しても別の塊として扱う。
export function splitClips(clips, split = null) {
  if (!split) {
    return clips.length > 0 ? [clips] : [];
  }
  const groups = [];
  for (const clip of clips) {
    const last = groups.at(-1);
    if (last && last.at(-1).videoId === clip.videoId) {
      last.push(clip);
    } else {
      groups.push([clip]);
    }
  }
  if (split.targetSec != null && groups.length > 0) {
    const balanced = balanceGroups(groups, split.targetSec, split.minSec);
    if (balanced) {
      return balanced;
    }
  }

  const parts = [];
  let pending = [];
  let duration = 0;
  for (const group of groups) {
    pending.push(...group);
    duration += group.reduce((sum, clip) => sum + (clip.endTime - clip.startTime), 0);
    if (duration >= split.minSec) {
      parts.push(pending);
      pending = [];
      duration = 0;
    }
  }
  if (pending.length > 0) {
    if (parts.length > 0) {
      parts.at(-1).push(...pending);
    } else {
      parts.push(pending);
    }
  }
  return parts;
}

// 塊の境目のどこで切るかを動的計画法で決め、(パート尺 - targetSec)² の和を最小にする。
// 前から詰める方式だと余りが末尾の 1 本に溜まる（ガハハの 11 以降を 50 秒で分けると最後が 113 秒）ため。
// どう切っても minSec 未満のパートが出る（全体が minSec 未満）なら null を返し、従来の分け方に任せる。
function balanceGroups(groups, targetSec, minSec = 0) {
  const durations = groups.map(trimmedSec);
  const n = groups.length;
  const cost = Array(n + 1).fill(Infinity);
  const from = Array(n + 1).fill(-1);
  cost[0] = 0;
  for (let end = 1; end <= n; end++) {
    let sec = 0;
    for (let start = end - 1; start >= 0; start--) {
      sec += durations[start];
      if (sec < minSec || cost[start] === Infinity) {
        continue;
      }
      const total = cost[start] + (sec - targetSec) ** 2;
      if (total < cost[end]) {
        cost[end] = total;
        from[end] = start;
      }
    }
  }
  if (cost[n] === Infinity) {
    return null;
  }
  const parts = [];
  for (let end = n; end > 0; end = from[end]) {
    parts.unshift(groups.slice(from[end], end).flat());
  }
  return parts;
}

// name.mp4 → name-01.mp4。拡張子が無ければ .mp4 を付ける。
export function partOutputPath(outPath, part) {
  const ext = path.extname(outPath);
  const stem = ext ? outPath.slice(0, -ext.length) : outPath;
  return `${stem}-${String(part).padStart(2, '0')}${ext || '.mp4'}`;
}

// --part N で 1 パートだけ描画し直す。番号は分割全体での通し番号を保つ。
export function selectParts(clips, config) {
  const parts = splitClips(clips, config.output.split);
  const value = config.__meta?.cli?.part;
  if (value === undefined) {
    return parts.map((partClips, i) => ({ clips: partClips, part: i + 1 }));
  }
  const part = Number(value);
  if (typeof value === 'boolean' || !config.output.split || !Number.isInteger(part) || part < 1 || part > parts.length) {
    throw new Error(`--part は output.split 有効時の 1〜${parts.length} で指定してください: ${value}`);
  }
  return [{ clips: parts[part - 1], part }];
}
