import { useNavigate } from 'react-router-dom';
import { AppRail } from '../components/app_rail';
import { MobileShell } from '../components/mobile/mobile_shell';
import { MobileBar, MobileBarButton, MobileBarTitle } from '../components/mobile/mobile_bar';
import { OneNoteCard } from '../components/settings/onenote_card';
import { ConnectedAppsCard } from '../components/settings/connected_apps_card';
import { ThemeSelector } from '../components/settings/theme_selector';
import { AppRoutes } from '../lib/app_routes';
import { useAuth } from '../lib/use_auth';
import { useIsMobile } from '../lib/use_is_mobile';

function SettingsBody() {
  const { user } = useAuth();

  return (
    <main className="settings-main">
      <div className="settings-inner">
        <header className="settings-header">
          <h1>Settings</h1>
        </header>

        <section className="settings-section">
          <h2>Account</h2>
          <dl className="settings-facts">
            <div>
              <dt>Name</dt>
              <dd>{user?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user?.email ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="settings-section">
          <h2>Appearance</h2>
          <div className="settings-row">
            <span className="settings-row-label">Theme</span>
            <ThemeSelector />
          </div>
        </section>

        <section className="settings-section">
          <h2>Connections</h2>
          <div className="settings-stack">
            <OneNoteCard />
            <ConnectedAppsCard />
          </div>
        </section>
      </div>
    </main>
  );
}

export function SettingsPage() {
  const is_mobile = useIsMobile();
  const navigate = useNavigate();

  // The rail's action is the workspace compose button, the same on every screen.
  const rail = (variant: 'rail' | 'drawer', onClose?: () => void) => (
    <AppRail
      variant={variant}
      onClose={onClose}
      action={{ label: 'New note', icon: 'plus', onClick: () => navigate(AppRoutes.newNote()) }}
    />
  );

  if (is_mobile) {
    return (
      <MobileShell rail={(close) => rail('drawer', close)}>
        {(openDrawer) => (
          <>
            <MobileBar>
              <MobileBarButton label="Menu" icon="menu" onClick={openDrawer} />
              <MobileBarTitle title="Settings" />
            </MobileBar>
            <SettingsBody />
          </>
        )}
      </MobileShell>
    );
  }

  return (
    <div className="workspace">
      {rail('rail')}
      <SettingsBody />
    </div>
  );
}
