import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/use_auth';

export function RequireAuth() {
  const { is_authenticated } = useAuth();
  const location = useLocation();
  if (!is_authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
