import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));

/** JSON ファイルを読み込む。 */
export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** JSON を字下げして保存する。 */
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/** プロジェクトと原曲の拍基準の旋律・音節境界を読み込む。 */
export function loadProject(name = 'tengoku-to-jigoku') {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error('プロジェクト名が不正です');
  }
  const dir = path.join(root, 'scripts/otomad/projects', name);
  const project = readJson(path.join(dir, 'project.json'));
  const melody = readJson(path.join(dir, 'melody.json')).notes;
  const boundaries = readJson(path.join(dir, 'boundaries.json'));
  if (
    !(
      project.beat.bpm > 0 &&
      project.beat.beatsPerBar > 0 &&
      project.range.toBar > project.range.fromBar
    )
  ) {
    throw new Error('拍または範囲の設定が不正です');
  }
  if (
    ![
      project.output.fps,
      project.output.sampleRate,
      project.output.width,
      project.output.height,
    ].every((n) => Number.isInteger(n) && n > 0)
  ) {
    throw new Error('出力設定は正の整数にしてください');
  }
  if (
    !melody.every(
      (n, i) =>
        n.len > 0 &&
        Number.isFinite(n.midi) &&
        n.beat >= project.range.fromBar * project.beat.beatsPerBar &&
        n.beat < project.range.toBar * project.beat.beatsPerBar &&
        (!i || n.beat > melody[i - 1].beat),
    )
  ) {
    throw new Error('旋律の音順・範囲が不正です');
  }
  return { project, melody, boundaries, dir };
}

/** 原曲の拍を原曲先頭からの秒へ変換する。 */
export const beatTime = (p, beat) => p.beat.offsetSec + (beat * 60) / p.beat.bpm;

/** 0 始まりの小節を原曲先頭からの秒へ変換する。 */
export const barTime = (p, bar) => beatTime(p, bar * p.beat.beatsPerBar);

/** プリロールを含むタイムライン先頭の原曲秒を返す。 */
export const timelineStart = (p) => barTime(p, p.range.fromBar - 1);

/** プリロールと余韻を含むタイムラインの秒数を返す。 */
export const timelineDuration = (p) => barTime(p, p.range.toBar + 2) - timelineStart(p);

/** 0 始まりの小節を含むセクションを探す。 */
export const sectionAt = (p, bar) => p.sections.find((s) => bar >= s.fromBar && bar < s.toBar);

/** 既存出力に続く連番ディレクトリのパスを返す。 */
export function nextOutput(p, parent = path.resolve(root, p.output.dir)) {
  fs.mkdirSync(parent, { recursive: true });
  const prefix = p.output.prefix;
  const nums = fs
    .readdirSync(parent)
    .filter((n) => n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length)))
    .map((n) => Number(n.slice(prefix.length)));
  return path.join(parent, prefix + String(Math.max(0, ...nums) + 1).padStart(2, '0'));
}

/** ファイル名に使えない文字を置き換える。 */
export const safeName = (text) =>
  String(text)
    .replaceAll('#', 's')
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_');

/** MIDI 音高をオクターブ付き音名にする。 */
export const noteName = (midi) =>
  ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'][((midi % 12) + 12) % 12] +
  (Math.floor(midi / 12) - 1);

/** 行オブジェクトを BOM 付き CSV にする。 */
export function csv(rows) {
  if (!rows.length) {
    return '';
  }
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const cell = (v) =>
    '"' +
    String(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v).replaceAll('"', '""') +
    '"';
  return (
    '\ufeff' +
    [keys, ...rows.map((r) => keys.map((k) => r[k]))]
      .map((row) => row.map(cell).join(','))
      .join('\n') +
    '\n'
  );
}

/** 原曲秒とタイムライン秒・フレームを持つ拍一覧を作る。 */
export function makeBeats(p) {
  const out = [];
  for (
    let b = (p.range.fromBar - 1) * p.beat.beatsPerBar;
    b < (p.range.toBar + 2) * p.beat.beatsPerBar;
    b++
  ) {
    const bar = Math.floor(b / p.beat.beatsPerBar);
    const timeSec = beatTime(p, b);
    const timelineSec = timeSec - timelineStart(p);
    out.push({
      beat: b,
      bar,
      beatInBar: b % p.beat.beatsPerBar,
      timeSec,
      section: sectionAt(p, bar)?.name || '',
      timelineSec,
      frame: Math.round(timelineSec * p.output.fps),
    });
  }
  return out;
}
