export interface DecodedTrack {
  name: string;
  notes: { tick: number; note: number; velocity: number }[];
  texts: { tick: number; text: string }[];
}
export interface DecodedMidi {
  division: number;
  tempos: { tick: number; usPerQuarter: number }[];
  timeSignatures: { tick: number; numerator: number; denominator: number }[];
  tracks: DecodedTrack[];
}

export function readMidi(bytes: Uint8Array): DecodedMidi {
  let pos = 0;
  const u32 = () => {
    const v = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    pos += 4;
    return v >>> 0;
  };
  const u16 = () => {
    const v = (bytes[pos] << 8) | bytes[pos + 1];
    pos += 2;
    return v;
  };
  // MThd
  pos += 4; // "MThd"
  u32(); // header length (6)
  u16(); // format
  const ntracks = u16();
  const division = u16();

  const result: DecodedMidi = { division, tempos: [], timeSignatures: [], tracks: [] };

  for (let t = 0; t < ntracks; t++) {
    pos += 4; // "MTrk"
    const len = u32();
    const end = pos + len;
    let tick = 0;
    let runningStatus = 0;
    const track: DecodedTrack = { name: '', notes: [], texts: [] };

    while (pos < end) {
      // delta
      let delta = 0;
      let b: number;
      do {
        b = bytes[pos++];
        delta = (delta << 7) | (b & 0x7f);
      } while (b & 0x80);
      tick += delta;

      let status = bytes[pos];
      if (status & 0x80) pos++;
      else status = runningStatus; // running status: reuse, byte is data
      if (status < 0xf0) runningStatus = status;

      if (status === 0xff) {
        const type = bytes[pos++];
        let mlen = 0;
        do {
          b = bytes[pos++];
          mlen = (mlen << 7) | (b & 0x7f);
        } while (b & 0x80);
        const data = bytes.subarray(pos, pos + mlen);
        pos += mlen;
        if (type === 0x51) {
          result.tempos.push({ tick, usPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] });
        } else if (type === 0x58) {
          result.timeSignatures.push({ tick, numerator: data[0], denominator: 2 ** data[1] });
        } else if (type === 0x03) {
          track.name = new TextDecoder().decode(data);
        } else if (type === 0x01) {
          track.texts.push({ tick, text: new TextDecoder().decode(data) });
        }
      } else if (status === 0xf0 || status === 0xf7) {
        let slen = 0;
        do {
          b = bytes[pos++];
          slen = (slen << 7) | (b & 0x7f);
        } while (b & 0x80);
        pos += slen;
      } else {
        const high = status & 0xf0;
        const d1 = bytes[pos++];
        if (high === 0xc0 || high === 0xd0) {
          // one data byte
        } else {
          const d2 = bytes[pos++];
          if (high === 0x90 && d2 > 0) track.notes.push({ tick, note: d1, velocity: d2 });
        }
      }
    }
    result.tracks.push(track);
    pos = end;
  }
  return result;
}
