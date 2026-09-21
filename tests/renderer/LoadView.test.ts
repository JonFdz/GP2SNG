import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoadView } from '../../src/renderer/src/views/LoadView';
import type { ParsedGpScore, ParsedGpTrack } from '../../src/shared/types/index';

const mockStore = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../src/renderer/src/state/wizardStore', () => ({
  useWizardStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mockStore.current),
}));

function score(noteCount: number): ParsedGpScore {
  const track: ParsedGpTrack = {
    id: 0,
    name: 'Drums',
    isDrumKit: true,
    noteCount,
    bars: [],
  };
  return {
    metadata: { title: '', subtitle: '', artist: '', album: '', copyright: '', tabber: '' },
    tempoAutomations: [],
    masterBars: [],
    tracks: [track],
  };
}

function render(score: ParsedGpScore | null, selectedTrackIds: number[]): string {
  mockStore.current = {
    gpFilePath: score === null ? null : 'song.gp',
    score,
    selectedTrackIds,
    loadScore: () => {},
    restoreSession: () => {},
    toggleTrack: () => {},
  };
  return renderToStaticMarkup(createElement(LoadView));
}

describe('LoadView selection feedback', () => {
  it('shows no selection feedback before a score is loaded', () => {
    expect(render(null, [])).not.toContain('Select at least one track to continue.');
  });

  it('asks for a track when the loaded score has no selected tracks', () => {
    const html = render(score(1), []);
    expect(html).toContain('Select at least one track to continue.');
    expect(html).not.toContain('The selected tracks have no notes.');
  });

  it('keeps the zero-note feedback distinct from empty selection', () => {
    const html = render(score(0), [0]);
    expect(html).toContain('The selected tracks have no notes.');
    expect(html).not.toContain('Select at least one track to continue.');
  });

  it('shows neither message for a valid selection', () => {
    const html = render(score(1), [0]);
    expect(html).not.toContain('The selected tracks have no notes.');
    expect(html).not.toContain('Select at least one track to continue.');
  });
});
