import { Navigate, Route, Routes } from 'react-router-dom';
import { NavBar } from './components/nav_bar';
import { RequireAuth } from './components/require_auth';
import { LoginPage } from './pages/login_page';
import { RegisterPage } from './pages/register_page';
import { NotesPage } from './pages/notes_page';
import { NoteDetailPage } from './pages/note_detail_page';
import { ChatPage } from './pages/chat_page';

export function App() {
  return (
    <div className="app-shell">
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Navigate to="/notes" replace />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/notes/:id" element={<NoteDetailPage />} />
            <Route path="/chat" element={<ChatPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/notes" replace />} />
        </Routes>
      </main>
    </div>
  );
}
