import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/use_auth';
import { AppRoutes } from '../lib/app_routes';
import { UserRoles } from '../lib/user_roles';

/** Nested inside RequireAuth. Keeps non-admins off pages whose every call would 403. */
export function RequireAdmin() {
  const { user } = useAuth();
  if (!UserRoles.isAdmin(user)) {
    return <Navigate to={AppRoutes.notes()} replace />;
  }
  return <Outlet />;
}
