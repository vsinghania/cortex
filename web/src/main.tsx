import { StrictMode, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiClient } from './lib/api_client';
import { BetaRoutes } from './beta/lib/beta_routes';

function Bootstrap() {
  const [app, set_app] = useState<{ Component: ComponentType } | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Each UI imports its own stylesheet, so loading only the one this path needs keeps
    // classic and beta styles from ever sharing a page. Crossing between them is a full
    // page load for the same reason.
    async function loadApp(): Promise<ComponentType> {
      if (BetaRoutes.isBetaPath(window.location.pathname)) {
        return (await import('./beta/beta_app')).BetaApp;
      }
      return (await import('./classic_app')).ClassicApp;
    }

    async function init() {
      const [Component] = await Promise.all([loadApp(), ApiClient.bootstrapSession()]);
      if (!cancelled) set_app({ Component });
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  // No spinner here: neither UI's stylesheet has loaded yet, and the wait is the
  // session refresh plus one chunk.
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
