import { useState } from 'react';
import { ConfirmDialog } from '../confirm_dialog';
import { Icon } from '../icon';
import { useToast } from '../toast';
import { DateFormat } from '../../lib/date_format';
import { useConnectedApps } from '../../lib/use_connected_apps';
import type { ConnectedApp } from '../../lib/connected_apps.types';

/** Scopes are per resource (`notes:write`, `articles:write`, …); any write scope means read & write. */
function accessLabel(scopes: readonly string[]): string {
  return scopes.some((scope) => scope.endsWith(':write')) ? 'Read & write' : 'Read only';
}

function McpUrlField({ name, url }: { name: string; url: string }) {
  const toast = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ message: `${name} connector URL copied` });
    } catch {
      toast.show({ message: "Couldn't copy. Select the URL and copy it yourself.", tone: 'error' });
    }
  }

  return (
    <div className="copy-field">
      <span className="copy-field-label">{name}</span>
      <code className="copy-field-value">{url}</code>
      <button type="button" className="icon-btn icon-btn-sm" aria-label={`Copy the ${name} connector URL`} title="Copy" onClick={() => void copy()}>
        <Icon name="copy" size={13} />
      </button>
    </div>
  );
}

function AppRow({ app, busy, onDisconnect }: { app: ConnectedApp; busy: boolean; onDisconnect: () => void }) {
  return (
    <li className="notebook-status-row">
      <span className="notebook-name" title={app.client_host ?? undefined}>
        {app.client_name}
        {app.client_host && <span className="notebook-muted"> · {app.client_host}</span>}
      </span>
      <span className="notebook-status">
        {app.resource_name ? `${app.resource_name} · ` : ''}
        {accessLabel(app.scopes)}
        {' · '}
        {app.last_used_at ? (
          <span title={DateFormat.full(app.last_used_at)}>used {DateFormat.relative(app.last_used_at)}</span>
        ) : (
          <span className="notebook-muted">not used yet</span>
        )}
      </span>
      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onDisconnect}>
        {busy ? 'Disconnecting…' : 'Disconnect'}
      </button>
    </li>
  );
}

export function ConnectedAppsCard() {
  const { status, loading, error, disconnecting, disconnect } = useConnectedApps();
  const [confirming, set_confirming] = useState<ConnectedApp | null>(null);

  const unavailable = status !== null && !status.available;
  const grants = status?.grants ?? [];

  async function handleDisconnect() {
    if (!confirming) return;
    await disconnect(confirming.grant_id);
    set_confirming(null);
  }

  return (
    <article className="connection-card">
      <div className="connection-head">
        <span className="connection-icon" aria-hidden="true">
          <Icon name="sparkle" size={18} />
        </span>
        <div className="connection-title">
          <h3>AI assistants</h3>
          <p>Search, read and update your notes from ChatGPT, Claude and other assistants that support MCP connectors.</p>
        </div>
      </div>

      {loading && <p className="connection-meta">Loading…</p>}

      {unavailable && <p className="connection-meta">Connecting assistants isn't available on this server yet.</p>}

      {!loading && !unavailable && status && status.resources.length > 0 && (
        <div className="connection-detail">
          <p className="connection-meta">
            In your assistant, add a custom connector and paste a URL below, one connector each. You'll sign in to Cortex
            and choose whether it can only read or also make changes.
          </p>
          {status.resources.map((resource) => (
            <McpUrlField key={resource.id} name={resource.name} url={resource.url} />
          ))}
        </div>
      )}

      {!loading && !unavailable && grants.length > 0 && (
        <ul className="notebook-status-list">
          {grants.map((app) => (
            <AppRow
              key={app.grant_id}
              app={app}
              busy={disconnecting === app.grant_id}
              onDisconnect={() => set_confirming(app)}
            />
          ))}
        </ul>
      )}

      {error && (
        <p className="connection-error" role="alert">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={`Disconnect ${confirming?.client_name ?? 'assistant'}?`}
        confirm_label="Disconnect"
        danger
        busy={disconnecting !== null}
        onConfirm={() => void handleDisconnect()}
        onCancel={() => set_confirming(null)}
      >
        It loses access to your notes straight away. You can connect it again from the assistant.
      </ConfirmDialog>
    </article>
  );
}
