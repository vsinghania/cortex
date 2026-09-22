import { useNavigate } from 'react-router-dom';
import { AppRail } from '../components/app_rail';
import { EmptyPanel } from '../components/empty_panel';
import { MobileShell } from '../components/mobile/mobile_shell';
import { MobileBar, MobileBarButton, MobileBarTitle } from '../components/mobile/mobile_bar';
import { AdminRailSection } from '../components/admin/admin_rail_section';
import { AdminUsersTable } from '../components/admin/admin_users_table';
import { AdminUserCard } from '../components/admin/admin_user_card';
import { AppRoutes } from '../lib/app_routes';
import { useIsMobile } from '../lib/use_is_mobile';
import { useAdminUsers, type AdminUsersState } from '../lib/use_admin_users';

function AdminUsersPager({ state }: { state: AdminUsersState }) {
  const { page, has_prev, has_next, prev, next, loading } = state;
  if (!page || page.total === 0) return null;
  const first = page.offset + 1;
  const last = page.offset + page.users.length;

  return (
    <footer className="admin-pager">
      <span className="mono-meta">
        {first}–{last} of {page.total}
      </span>
      <div className="admin-pager-actions">
        <button type="button" className="btn btn-outline" onClick={prev} disabled={!has_prev || loading}>
          Previous
        </button>
        <button type="button" className="btn btn-outline" onClick={next} disabled={!has_next || loading}>
          Next
        </button>
      </div>
    </footer>
  );
}

function AdminUsersContent({ state, is_mobile }: { state: AdminUsersState; is_mobile: boolean }) {
  const { page, loading, error, reload } = state;

  if (error) {
    return (
      <EmptyPanel
        icon="info"
        title={error}
        actions={
          <button type="button" className="btn btn-outline" onClick={() => void reload()}>
            Try again
          </button>
        }
      />
    );
  }
  if (!page) return loading ? <p className="admin-muted admin-loading">Loading users…</p> : null;
  if (page.users.length === 0) return <EmptyPanel icon="users" title="No users yet" />;

  return is_mobile ? (
    <ul className="admin-cards">
      {page.users.map((user) => (
        <AdminUserCard key={user.user_id} user={user} />
      ))}
    </ul>
  ) : (
    <AdminUsersTable users={page.users} />
  );
}

function AdminUsersBody({ is_mobile }: { is_mobile: boolean }) {
  const state = useAdminUsers();

  return (
    <main className="settings-main">
      <div className="admin-inner">
        {!is_mobile && (
          <header className="settings-header">
            <h1>Users</h1>
          </header>
        )}
        <section className={`admin-section${state.loading && state.page ? ' admin-section-busy' : ''}`}>
          <AdminUsersContent state={state} is_mobile={is_mobile} />
          <AdminUsersPager state={state} />
        </section>
      </div>
    </main>
  );
}

export function AdminUsersPage() {
  const is_mobile = useIsMobile();
  const navigate = useNavigate();

  const rail = (variant: 'rail' | 'drawer', onClose?: () => void) => (
    <AppRail
      variant={variant}
      onClose={onClose}
      action={{ label: 'New note', icon: 'plus', onClick: () => navigate(AppRoutes.newNote()) }}
    >
      {(collapsed) => <AdminRailSection collapsed={collapsed} />}
    </AppRail>
  );

  if (is_mobile) {
    return (
      <MobileShell rail={(close) => rail('drawer', close)}>
        {(openDrawer) => (
          <>
            <MobileBar>
              <MobileBarButton label="Menu" icon="menu" onClick={openDrawer} />
              <MobileBarTitle title="Users" />
            </MobileBar>
            <AdminUsersBody is_mobile />
          </>
        )}
      </MobileShell>
    );
  }

  return (
    <div className="workspace">
      {rail('rail')}
      <AdminUsersBody is_mobile={false} />
    </div>
  );
}
