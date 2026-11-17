import { useEffect, useState, type FormEvent, type ReactElement } from 'react';

import { AppShell, type AdminView } from './components/AppShell';
import { ThemeToggle } from './components/ThemeToggle';
import { clearAdminApiKey, getAdminApiKey, setAdminApiKey } from './lib/api';
import { Dashboard } from './pages/Dashboard';
import { KnowledgeHub } from './pages/KnowledgeHub';
import { ProviderSettings } from './pages/ProviderSettings';
import { VoiceStudio } from './pages/VoiceStudio';

/** Root application that preserves navigation locally and delegates server state to TanStack Query. */
export function App() {
  const [activeView, setActiveView] = useState<AdminView>('dashboard');
  const [adminApiKey, setAdminApiKeyState] = useState<string | null>(getAdminApiKey);
  const [keyInput, setKeyInput] = useState('');
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    const handleAuthRequired = () => {
      setAdminApiKeyState(null);
      setLoginError('The API key was rejected. Check it and try again.');
    };
    window.addEventListener('omnivox-admin-auth-required', handleAuthRequired);
    return () => window.removeEventListener('omnivox-admin-auth-required', handleAuthRequired);
  }, []);

  function submitApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedKey = keyInput.trim();
    if (!trimmedKey) {
      setLoginError('Enter the administrative API key configured on the backend.');
      return;
    }
    setAdminApiKey(trimmedKey);
    setAdminApiKeyState(trimmedKey);
    setKeyInput('');
    setLoginError('');
  }

  function logout() {
    clearAdminApiKey();
    setAdminApiKeyState(null);
    setActiveView('dashboard');
  }

  if (!adminApiKey) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mesh px-4">
        <form
          onSubmit={submitApiKey}
          className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/95 p-8 shadow-2xl dark:border-slate-800 dark:bg-slate-950/90"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">OmniVox Admin</p>
            <ThemeToggle compact />
          </div>
          <h1 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">Administrative sign-in</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
            Enter the admin API key configured on the backend. It is kept in this tab only.
          </p>
          <label htmlFor="admin-api-key" className="mt-6 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Admin API key
          </label>
          <input
            id="admin-api-key"
            type="password"
            autoComplete="current-password"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-indigo-400 dark:focus:ring-indigo-400/30"
          />
          {loginError && <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-300">{loginError}</p>}
          <button
            type="submit"
            className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Continue
          </button>
        </form>
      </main>
    );
  }

  const content = {
    dashboard: <Dashboard onOpenProviders={() => setActiveView('provider-settings')} />,
    'voice-studio': <VoiceStudio />,
    'knowledge-hub': <KnowledgeHub />,
    'provider-settings': <ProviderSettings />,
  } satisfies Record<AdminView, ReactElement>;

  return (
    <AppShell activeView={activeView} onViewChange={setActiveView} onLogout={logout}>
      {content[activeView]}
    </AppShell>
  );
}
