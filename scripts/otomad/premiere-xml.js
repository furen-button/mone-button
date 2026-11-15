import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { timelineDuration, sectionAt } from './project.js';

/** 文字列を XML 用にエスケープする。 */
export const escapeXml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );

/** ファイルの絶対パスを Premiere 用 URL にする。 */
export function pathUrl(file) {
  return pathToFileURL(path.resolve(file)).href.replace('file:///', 'file://localhost/');
}

/** タイムラインのフレーム基準で小節と映像効果のマーカーを作る。 */
export function markers(p, beats, score) {
  const out = beats
    .filter((b) => b.beatInBar === 0)
    .map((b) => {
      const section = sectionAt(p, b.bar);
      const voice = section && p.voices[section.voice];
      return {
        frame: b.frame,
        name: `小節 ${b.bar}${section?.fromBar === b.bar ? '｜' + section.name + '（' + voice.label + '）' : ''}`,
      };
    });
  for (const e of score) {
    if (e.fx.hflip) {
      out.push({ frame: e.videoStartFrame, name: '反転' });
    }
    if (e.fx.zoom !== 1) {
      out.push({ frame: e.videoStartFrame, name: `ズーム ${Number(e.fx.zoom.toFixed(2))}` });
    }
  }
  return out.sort((a, b) => a.frame - b.frame);
}

/** タイムラインのフレーム基準で Premiere 用 FCP7 XML を作る。 */
export function premiereXml(p, score, beats, out) {
  const fps = p.output.fps;
  const sr = p.output.sampleRate;
  const duration = Math.round(timelineDuration(p) * fps);
  const rate = (f = fps) =>
    `<rate><timebase>${Math.round(f)}</timebase>` +
    `<ntsc>${Math.abs(f - (Math.round(f) * 1000) / 1001) < 0.002 ? 'TRUE' : 'FALSE'}` +
    `</ntsc></rate>`;
  const videoFormat =
    `<width>${p.output.width}</width><height>${p.output.height}` +
    `</height><anamorphic>FALSE</anamorphic>` +
    `<pixelaspectratio>square</pixelaspectratio>` +
    `<fielddominance>none</fielddominance>`;
  const seen = new Map();
  let nextFile = 0;
  let nextClip = 0;
  function file(rel, type, frames, info = {}) {
    if (seen.has(rel)) {
      return `<file id="${seen.get(rel)}"/>`;
    }
    const id = `file-${++nextFile}`;
    seen.set(rel, id);
    const sourceRate = type === 'video' ? info.fps || fps : fps;
    const media =
      type === 'video'
        ? `<video><samplecharacteristics>${rate(sourceRate)}` +
          `<width>${info.width || p.output.width}` +
          `</width><height>${info.height || p.output.height}` +
          `</height><anamorphic>FALSE</anamorphic>` +
          `<pixelaspectratio>square</pixelaspectratio>` +
          `<fielddominance>none</fielddominance>` +
          `</samplecharacteristics></video>`
        : `<audio><samplecharacteristics><depth>16` +
          `</depth><samplerate>${sr}</samplerate>` +
          `</samplecharacteristics><channelcount>${info.channels || 1}` +
          `</channelcount></audio>`;
    return (
      `<file id="${id}"><name>${escapeXml(path.basename(rel))}` +
      `</name><pathurl>${escapeXml(pathUrl(path.join(out, rel)))}` +
      `</pathurl>${rate(sourceRate)}<duration>${frames}` +
      `</duration><media>${media}</media></file>`
    );
  }
  function clip({
    name,
    rel,
    type,
    start,
    end,
    srcIn = 0,
    srcOut,
    enabled = true,
    frames = end - start,
    info = {},
    gain = 1,
  }) {
    const sourceFps = type === 'video' ? info.fps || fps : fps;
    const volume =
      gain === 1
        ? ''
        : `<filter><effect><name>Audio Levels</name>` +
          `<effectid>audiolevels</effectid><effectcategory>audiolevels` +
          `</effectcategory><effecttype>audiolevels` +
          `</effecttype><mediatype>audio</mediatype>` +
          `<parameter><parameterid>level</parameterid>` +
          `<name>Level</name><valuemin>0</valuemin>` +
          `<valuemax>3.98109</valuemax><value>${gain}` +
          `</value></parameter></effect></filter>`;
    return (
      `<clipitem id="clip-${++nextClip}"><name>${escapeXml(name)}` +
      `</name><enabled>${enabled ? 'TRUE' : 'FALSE'}` +
      `</enabled><duration>${frames}</duration>${rate(sourceFps)}` +
      `<start>${start}</start><end>${end}</end>` +
      `<in>${srcIn}</in><out>${srcOut ?? srcIn + end - start}` +
      `</out>${file(rel, type, frames, info)}` +
      `<sourcetrack><mediatype>${type}</mediatype>` +
      `<trackindex>1</trackindex></sourcetrack>${volume}` +
      `</clipitem>`
    );
  }
  const video = [];
  for (const e of score.filter((e) => e.videoFrames > 0)) {
    const info = e.sourceInfo || {
      duration: 10,
      fps,
      width: p.output.width,
      height: p.output.height,
    };
    const sourceFps = info.fps || fps;
    const sourceFrames = Math.max(1, Math.floor(info.duration * sourceFps));
    const srcIn = Math.min(
      sourceFrames - 1,
      Math.max(0, Math.round((e.videoSourceStart ?? e.hqSourceStart) * sourceFps)),
    );
    const available = Math.max(1, Math.floor(((sourceFrames - srcIn) / sourceFps) * fps));
    const moving = Math.min(e.videoFrames, available);
    video.push(
      clip({
        name: e.kana,
        rel: e.sampleFile,
        type: 'video',
        start: e.videoStartFrame,
        end: e.videoStartFrame + moving,
        srcIn,
        srcOut: Math.min(sourceFrames, srcIn + Math.round((moving / fps) * sourceFps)),
        frames: sourceFrames,
        info,
      }),
    );
    if (moving < e.videoFrames) {
      // 元動画が足りない分は、最後のフレームを止めた別ファイル（clip-hold.mp4、10 秒）を置く。
      // Time Remap の速度 0 は Premiere の読み込みで再現されない恐れがあるため使わない。
      const holdFrames = 10 * fps;
      const length = Math.min(holdFrames, e.videoEndFrame - e.videoStartFrame - moving);
      video.push(
        clip({
          name: e.kana + '（最終フレーム静止）',
          rel: e.holdFile,
          type: 'video',
          start: e.videoStartFrame + moving,
          end: e.videoStartFrame + moving + length,
          srcIn: 0,
          srcOut: length,
          frames: holdFrames,
          info: { fps, width: p.output.width, height: p.output.height },
        }),
      );
    }
  }
  const voices = (kind) =>
    score
      .filter((e) => e.kind === kind)
      .map((e) =>
        clip({
          name: e.kana,
          rel: e.audioFile,
          type: 'audio',
          start: e.padding.frame,
          end: e.padding.frame + e.audioFrames,
          frames: e.audioFrames,
        }),
      )
      .join('');
  const a1 = clip({
    name: '曲',
    rel: 'audio/backing.wav',
    type: 'audio',
    start: 0,
    end: duration,
    info: { channels: 2 },
    gain: p.output.trackGain,
  });
  const a4 = clip({
    name: '声の完成ミックス',
    rel: 'audio/voice-mix.wav',
    type: 'audio',
    start: 0,
    end: duration,
    enabled: false,
  });
  const marker = markers(p, beats, score)
    .map(
      (m) => `<marker><name>${escapeXml(m.name)}</name><in>${m.frame}</in><out>-1</out></marker>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE xmeml>\n<xmeml version="4">` +
    `<sequence id="sequence-1"><name>${escapeXml(p.title)}` +
    `</name><duration>${duration}</duration>${rate()}` +
    `<timecode>${rate()}<string>00:00:00:00` +
    `</string><frame>0</frame><displayformat>NDF` +
    `</displayformat></timecode><media><video>` +
    `<format><samplecharacteristics>${rate()}${videoFormat}` +
    `</samplecharacteristics></format><track>${video.join('')}` +
    `</track></video><audio><format><samplecharacteristics>` +
    `<depth>16</depth><samplerate>${sr}</samplerate>` +
    `</samplecharacteristics></format><numOutputChannels>2` +
    `</numOutputChannels><track>${a1}</track>` +
    `<track>${voices('melody')}</track><track>${voices('accent')}` +
    `</track><track>${a4}</track></audio>` +
    `</media>${marker}</sequence></xmeml>\n`
  );
}
