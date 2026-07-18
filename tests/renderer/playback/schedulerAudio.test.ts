import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../../../src/renderer/src/playback/scheduler';

// Regression coverage for the Scheduler's audio-source lifecycle (docs/DESIGN.md →
// Chart preview → Playback, clock & audio sync). The Web Audio wiring is otherwise
// manual-verified; a minimal fake AudioContext lets us lock in two fixed bugs:
//   1. adding/replacing/removing the buffer while playing must resync the source, and
//   2. a first play on a suspended context must defer start() until resume() resolves.

class FakeParam {
  value = 0;
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}

class FakeSource {
  buffer: unknown = null;
  playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  startCount = 0;
  stopCount = 0;
  connect() {}
  disconnect() {}
  start() {
    this.startCount++;
  }
  stop() {
    this.stopCount++;
  }
}

class FakeGain {
  gain = new FakeParam();
  connect() {}
  disconnect() {}
}

// Sources created by the scheduler under test, newest last.
let created: FakeSource[] = [];
// The most recently constructed context, so tests can drive its async resume.
let lastContext: FakeContext | null = null;
// The state a freshly constructed context reports (suspended vs. running).
let nextState: 'suspended' | 'running' = 'running';

class FakeContext {
  state: 'suspended' | 'running' = nextState;
  currentTime = 0;
  destination = {};
  private resolveResume: (() => void) | null = null;

  constructor() {
    lastContext = this;
  }
  createGain() {
    return new FakeGain();
  }
  createBufferSource() {
    const s = new FakeSource();
    created.push(s);
    return s;
  }
  resume() {
    return new Promise<void>((resolve) => {
      this.resolveResume = resolve;
    });
  }
  // Complete a pending resume(), flipping the context to running.
  finishResume() {
    this.state = 'running';
    this.resolveResume?.();
  }
  close() {
    return Promise.resolve();
  }
}

const startedSources = () => created.filter((s) => s.startCount > 0);
const fakeBuffer = () => ({}) as unknown as AudioBuffer;
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

let originalAudioContext: unknown;

beforeEach(() => {
  created = [];
  lastContext = null;
  nextState = 'running';
  originalAudioContext = Reflect.get(globalThis, 'AudioContext');
  Reflect.set(globalThis, 'AudioContext', FakeContext);
});

afterEach(() => {
  Reflect.set(globalThis, 'AudioContext', originalAudioContext);
});

describe('Scheduler buffer sync while playing', () => {
  it('starts the audio source when a buffer is added mid-playback', () => {
    const sch = new Scheduler();
    sch.play(0, 0); // playing with no buffer yet -> no source
    expect(startedSources()).toHaveLength(0);

    const buffer = fakeBuffer();
    sch.setBuffer(buffer);

    expect(startedSources()).toHaveLength(1);
    expect(startedSources()[0].buffer).toBe(buffer);
  });

  it('swaps the source when the buffer is replaced mid-playback', () => {
    const sch = new Scheduler();
    sch.setBuffer(fakeBuffer());
    sch.play(0, 0);
    const first = created.at(-1);

    sch.setBuffer(fakeBuffer());

    expect(first?.stopCount).toBe(1);
    expect(startedSources()).toHaveLength(2); // old stopped, new started
  });

  it('stops the source when the buffer is removed mid-playback', () => {
    const sch = new Scheduler();
    sch.setBuffer(fakeBuffer());
    sch.play(0, 0);
    const src = created.at(-1);

    sch.setBuffer(null);

    expect(src?.stopCount).toBe(1);
    expect(startedSources()).toHaveLength(1); // no new source created
  });

  it('does not restart the source while stopped', () => {
    const sch = new Scheduler();
    sch.setBuffer(fakeBuffer());
    expect(startedSources()).toHaveLength(0); // buffer stored, nothing playing
  });
});

describe('Scheduler first play on a suspended context', () => {
  it('defers the source start until resume resolves', async () => {
    nextState = 'suspended';
    const sch = new Scheduler();
    sch.setBuffer(fakeBuffer());

    sch.play(0, 0);
    // Context still suspended: scheduling start() now would race the resume.
    expect(startedSources()).toHaveLength(0);

    lastContext?.finishResume();
    await flushMicrotasks();

    expect(startedSources()).toHaveLength(1);
  });

  it('starts immediately when the context is already running', () => {
    nextState = 'running';
    const sch = new Scheduler();
    sch.setBuffer(fakeBuffer());

    sch.play(0, 0);

    expect(startedSources()).toHaveLength(1);
  });
});
