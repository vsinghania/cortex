import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app';
import { ApiClient } from './lib/api_client';
import { Spinner } from './components/spinner';
import './styles.css';

function Bootstrap() {
  const [ready, set_ready] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      await ApiClient.bootstrapSession();
      if (!cancelled) set_ready(true);
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="boot-shell">
        <Spinner label="Loading…" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <App />
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
