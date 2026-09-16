import { StrictMode, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiClient } from './lib/api_client';

function Bootstrap() {
  const [app, set_app] = useState<{ Component: ComponentType } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const [module] = await Promise.all([import('./beta/beta_app'), ApiClient.bootstrapSession()]);
      const Component = module.BetaApp;
      if (!cancelled) set_app({ Component });
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  // No spinner here: the stylesheet has not loaded yet, and the wait is the session
  // refresh plus one chunk.
  if (!app) return null;

  return (
    <BrowserRouter>
      <app.Component />
    </BrowserRouter>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing in index.html');

createRoot(container).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
);
