import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/use_auth';
import { ApiClient } from '../lib/api_client';

export function NavBar() {
  const { user, is_authenticated } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await ApiClient.logout();
    } finally {
      navigate('/login', { replace: true });
    }
  }

  return (
    <nav className="nav-bar">
      <div className="nav-brand">
        <Link to="/">cortex</Link>
      </div>
      {is_authenticated && (
        <div className="nav-links">
          <Link to="/notes">Notes</Link>
          <Link to="/chat">Chat</Link>
          <Link to="/voice">Voice</Link>
          <span className="nav-user">{user?.email}</span>
          <button type="button" onClick={handleLogout} className="link-button">
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}
