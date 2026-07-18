import { useEffect, useRef, useState } from 'react';
import { WizardShell } from './app/WizardShell';
import { useSettingsStore } from './state/settingsStore';
import { useWizardStore } from './state/wizardStore';
import { SettingsView } from './views/SettingsView';

type Tab = 'convert' | 'settings';

export function App() {
  const [tab, setTab] = useState<Tab>('convert');
  const [dismissed, setDismissed] = useState(false);
  const loadFailed = useSettingsStore((s) => s.loadFailed);
  const hydrate = useSettingsStore((s) => s.hydrate);

  // Scroll the content area back to the top whenever the user navigates to a new
  // page (tab switch or wizard step change).
  const mainRef = useRef<HTMLElement>(null);
  const step = useWizardStore((s) => s.step);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tab/step are navigation triggers
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [tab, step]);

  return (
    <div className="app-shell">
      <nav className="tab-strip">
        <button
          type="button"
          className={tab === 'convert' ? 'tab tab--active' : 'tab'}
          onClick={() => setTab('convert')}
        >
          Convert
        </button>
        <button
          type="button"
          className={tab === 'settings' ? 'tab tab--active' : 'tab'}
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
      </nav>

      {loadFailed && !dismissed && (
        <div className="startup-notice">
          <span>Saved settings or MIDI map could not be read; defaults are in use.</span>
          <button
            type="button"
            className="startup-notice__dismiss"
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </button>
        </div>
      )}

      <main ref={mainRef} className="tab-body">
        {tab === 'convert' ? <WizardShell /> : <SettingsView />}
      </main>
    </div>
  );
}
