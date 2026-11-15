/** MIDI の非負デルタ時刻を可変長バイト列にする。 */
export function vlq(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0x0fffffff) {
    throw new Error('MIDI のデルタ時刻が範囲外です');
  }
  const out = [n & 127];
  while ((n = Math.floor(n / 128))) {
    out.unshift((n & 127) | 128);
  }
  return out;
}

/** 拍単位の旋律を開始拍基準の format 0 MIDI にする。 */
export function midiBuffer(notes, bpm = 168, startBeat = 0) {
  const tempo = Math.round(60000000 / bpm);
  const events = [];
  for (const n of notes) {
    const start = Math.round((n.beat - startBeat) * 480);
    const end = Math.round((n.beat - startBeat + n.len) * 480);
    events.push(
      { t: start, order: 1, b: [0x90, n.midi, 96] },
      { t: end, order: 0, b: [0x80, n.midi, 0] },
    );
  }
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  const track = [0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255];
  let last = 0;
  for (const e of events) {
    track.push(...vlq(e.t - last), ...e.b);
    last = e.t;
  }
  track.push(0, 0xff, 0x2f, 0);
  const header = Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0]);
  const chunk = Buffer.alloc(8);
  chunk.write('MTrk');
  chunk.writeUInt32BE(track.length, 4);
  return Buffer.concat([header, chunk, Buffer.from(track)]);
}
