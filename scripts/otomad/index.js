import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadProject, nextOutput, makeBeats, writeJson, csv, timelineDuration } from './project.js';
import { resolveTools, run } from './audio.js';
import { prepareSamples, importBoundaries } from './samples.js';
import { buildScore, videoSlots } from './score.js';
import { renderAudio, renderGuides } from './render-audio.js';
import { renderVideo } from './render-video.js';
import { premiereXml } from './premiere-xml.js';
import { midiBuffer } from './midi.js';
import { writeReports } from './report.js';

/** コマンドライン引数から音 MAD 素材一式を生成する。 */
export function cli(argv = process.argv.slice(2)) {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string', default: 'tengoku-to-jigoku' },
      out: { type: 'string' },
      'no-download': { type: 'boolean' },
      'no-pitch-pack': { type: 'boolean' },
      candidates: { type: 'string' },
      'import-boundaries': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (v.help) {
    console.log(
      '使い方: npm run otomad -- [--project tengoku-to-jigoku] [--out <dir>] ' +
        '[--no-download] [--no-pitch-pack] [--candidates <n>] ' +
        '[--import-boundaries <assetsDir>]',
    );
    return;
  }
  const options = {
    noDownload: !!v['no-download'],
    noPitchPack: !!v['no-pitch-pack'],
    candidates: v.candidates === undefined ? undefined : Number(v.candidates),
  };
  if (
    options.candidates !== undefined &&
    (!Number.isInteger(options.candidates) || options.candidates < 1)
  ) {
    throw new Error('--candidates は 1 以上の整数にしてください');
  }
  const { project: p, melody, boundaries, dir } = loadProject(v.project);
  if (v['import-boundaries']) {
    importBoundaries(v['import-boundaries'], dir);
    return;
  }
  console.log(`プロジェクトを読み込みました: ${p.title}`);
  const tools = resolveTools();
  const out = v.out ? path.resolve(v.out) : nextOutput(p);
  // 未完了の出力を成功と誤認しないよう、完了時のみ README を作る。
  if (fs.existsSync(out)) {
    throw new Error(`出力先が既にあります（上書きしません）: ${out}`);
  }
  for (const sub of ['beats', 'melody', 'score', 'audio', 'samples', 'premiere', '.work']) {
    fs.mkdirSync(path.join(out, sub), { recursive: true });
  }
  fs.writeFileSync(
    path.join(out, '生成中.txt'),
    '生成はまだ完了していません。エラー時はログを確認してください。\n',
  );
  console.log(`出力先: ${out}`);
  const beats = makeBeats(p);
  writeJson(path.join(out, 'beats/beats.json'), beats);
  fs.writeFileSync(path.join(out, 'beats/beats.csv'), csv(beats));
  writeJson(path.join(out, 'melody/melody.json'), {
    ...JSON.parse(fs.readFileSync(path.join(dir, 'melody.json'), 'utf8')),
    timelineStartBar: p.range.fromBar - 1,
  });
  fs.writeFileSync(path.join(out, 'melody/melody.csv'), csv(melody));
  fs.writeFileSync(
    path.join(out, 'melody/melody.mid'),
    midiBuffer(melody, p.beat.bpm, (p.range.fromBar - 1) * p.beat.beatsPerBar),
  );
  renderGuides(p, melody, beats, out);
  const { samples, index } = prepareSamples(p, boundaries, out, options, tools);
  const score = videoSlots(buildScore(p, melody, samples), timelineDuration(p), p.output.fps);
  console.log(
    `譜面: 旋律 ${score.filter((e) => e.kind === 'melody').length} 音、アクセント` +
      ` ${score.filter((e) => e.kind === 'accent').length} 件`,
  );
  const gains = renderAudio(p, score, out, tools);
  writeJson(path.join(out, 'score/score.json'), score);
  renderVideo(p, score, out, tools);
  writeJson(path.join(out, 'score/score.json'), score);
  fs.writeFileSync(path.join(out, 'score/score.csv'), csv(score));
  const xmlFile = path.join(out, 'premiere', p.name + '.xml');
  fs.writeFileSync(xmlFile, premiereXml(p, score, beats, out));
  run('xmllint', ['--noout', xmlFile]);
  writeReports(p, dir, out, score, index, gains, options);
  fs.rmSync(path.join(out, '.work'), { recursive: true, force: true });
  fs.rmSync(path.join(out, '生成中.txt'));
  console.log(`素材一式の生成が完了しました: ${out}`);
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    cli();
  } catch (e) {
    console.error(`音MAD 素材の生成を停止しました: ${e.message}`);
    process.exitCode = 1;
  }
}
