import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiClient, ApiError } from '../lib/api_client';
import { AuthLayout } from '../components/auth/auth_layout';
import { useAuth } from '../lib/use_auth';
import type { McpAccess, OAuthConsentRequest } from '../lib/connected_apps.types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; request: OAuthConsentRequest }
  | { kind: 'gone' }
  | { kind: 'failed' };

function AccessChoice({
  request,
  access,
  onChange,
}: {
  request: OAuthConsentRequest;
  access: McpAccess;
  onChange: (access: McpAccess) => void;
}) {
  return (
    <fieldset className="consent-options">
      <legend className="consent-legend">What can {request.client_name} do with your {request.resource.name.toLowerCase()}?</legend>
      {request.access_options.map((option) => {
        // An app cannot be handed more than it asked for.
        const disabled = !option.available;
        return (
          <label
            key={option.value}
            className={`consent-option${access === option.value ? ' consent-option-active' : ''}${disabled ? ' consent-option-disabled' : ''}`}
          >
            <input
              type="radio"
              name="access"
              value={option.value}
              checked={access === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="consent-option-text">
              <span className="consent-option-label">{option.label}</span>
              <span className="consent-option-detail">{option.detail}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function ConsentForm({ request }: { request: OAuthConsentRequest }) {
  const { user } = useAuth();
  const [access, set_access] = useState<McpAccess>(request.default_access);
  const [busy, set_busy] = useState<'approve' | 'deny' | null>(null);
  const [error, set_error] = useState<string | null>(null);

  async function answer(kind: 'approve' | 'deny') {
    set_busy(kind);
    set_error(null);
    try {
      const { redirect_url } =
        kind === 'approve'
          ? await ApiClient.approveOAuthRequest(request.request_id, access)
          : await ApiClient.denyOAuthRequest(request.request_id);
      // Leaves the app for the assistant's own callback, which finishes the connection.
      window.location.assign(redirect_url);
    } catch (err) {
      set_error(
        err instanceof ApiError && err.status === 404
          ? 'This request has expired. Go back to your assistant and connect again.'
          : "We couldn't complete that. Try again."
      );
      set_busy(null);
    }
  }

  return (
    <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void answer('approve'); }}>
      <div className="auth-heading">
        <h1>Connect {request.client_name} to {request.resource.name}</h1>
        <p>
          An app from <strong>{request.client_host}</strong>, calling itself <strong>{request.client_name}</strong>, wants
          to use the {request.resource.name.toLowerCase()} in your Cortex account
          {user?.email ? <> (<strong>{user.email}</strong>)</> : null}. When you answer, you'll be sent back
          to <strong>{request.redirect_host}</strong>.
        </p>
      </div>

      <AccessChoice request={request} access={access} onChange={set_access} />

      <p className="consent-caution">
        Only continue if you started this yourself and you recognise {request.client_host}. The name is supplied by
        the app; the address is not. You can disconnect it at any time in Settings.
      </p>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="consent-actions">
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy !== null} aria-busy={busy === 'approve'}>
          {busy === 'approve' ? 'Connecting…' : 'Allow'}
        </button>
        <button
          type="button"
          className="btn btn-outline btn-lg"
          disabled={busy !== null}
          aria-busy={busy === 'deny'}
          onClick={() => void answer('deny')}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ConnectPage() {
  const [search_params] = useSearchParams();
  const request_id = search_params.get('request');
  const [state, set_state] = useState<LoadState>(() => (request_id ? { kind: 'loading' } : { kind: 'gone' }));

  useEffect(() => {
    if (!request_id) return;
    let cancelled = false;

    async function load(id: string) {
      try {
        const { request } = await ApiClient.getOAuthRequest(id);
        if (!cancelled) set_state({ kind: 'ready', request });
      } catch (err) {
        if (!cancelled) set_state(err instanceof ApiError && err.status === 404 ? { kind: 'gone' } : { kind: 'failed' });
      }
    }

    void load(request_id);
    return () => {
      cancelled = true;
    };
  }, [request_id]);

  return (
    <AuthLayout>
      {state.kind === 'loading' && <p className="connection-meta">Loading…</p>}
      {state.kind === 'ready' && <ConsentForm request={state.request} />}
      {state.kind === 'gone' && (
        <div className="auth-heading">
          <h1>This link has expired</h1>
          <p>Connection requests last a few minutes and work once. Go back to your assistant and connect Cortex again.</p>
        </div>
      )}
      {state.kind === 'failed' && (
        <div className="auth-heading">
          <h1>Something went wrong</h1>
          <p>We couldn't load this connection request. Reload the page, or start again from your assistant.</p>
        </div>
      )}
    </AuthLayout>
  );
}
