import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/src/App';

const settings = vi.hoisted(() => ({
  current: { hydrated: false, loadFailed: false, hydrate: vi.fn() },
}));

vi.mock('../../src/renderer/src/state/settingsStore', () => ({
  useSettingsStore: (selector: (state: typeof settings.current) => unknown) =>
    selector(settings.current),
}));
vi.mock('../../src/renderer/src/state/wizardStore', () => ({
  useWizardStore: (selector: (state: { step: string }) => unknown) => selector({ step: 'load' }),
}));
vi.mock('../../src/renderer/src/app/WizardShell', () => ({
  WizardShell: () => createElement('div', null, 'Conversion UI'),
}));
vi.mock('../../src/renderer/src/views/SettingsView', () => ({
  SettingsView: () => createElement('div', null, 'Settings UI'),
}));

describe('App settings hydration boundary', () => {
  it('renders only a loading state before settings hydrate', () => {
    settings.current = { hydrated: false, loadFailed: false, hydrate: vi.fn() };

    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain('Loading settings…');
    expect(html).not.toContain('Conversion UI');
    expect(html).not.toContain('Settings');
  });

  it('mounts the interactive application after hydration', () => {
    settings.current = { hydrated: true, loadFailed: false, hydrate: vi.fn() };

    const html = renderToStaticMarkup(createElement(App));

    expect(html).toContain('Conversion UI');
    expect(html).toContain('Settings');
    expect(html).not.toContain('Loading settings…');
  });

  it('preserves the startup warning after fallback hydration', () => {
    settings.current = { hydrated: true, loadFailed: true, hydrate: vi.fn() };

    expect(renderToStaticMarkup(createElement(App))).toContain(
      'Saved settings or MIDI map could not be read; defaults are in use.',
    );
  });
});
