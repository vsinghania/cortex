import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/use_auth';
import { AppRoutes } from '../lib/app_routes';

export function RequireAuth() {
  const { is_authenticated } = useAuth();
  const location = useLocation();
  if (!is_authenticated) {
    // Keep the query string so a citation deep-link survives the login bounce.
    const from = `${location.pathname}${location.search}`;
    return <Navigate to={AppRoutes.login()} replace state={{ from }} />;
  }
  return <Outlet />;
}
