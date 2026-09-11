import { Navigate, Route, Routes } from 'react-router-dom';
import { NavBar } from './components/nav_bar';
import { RequireAuth } from './components/require_auth';
import { LoginPage } from './pages/login_page';
import { RegisterPage } from './pages/register_page';
import { ForgotPasswordPage } from './pages/forgot_password_page';
import { ResetPasswordPage } from './pages/reset_password_page';
import { NotesPage } from './pages/notes_page';
import { NoteDetailPage } from './pages/note_detail_page';
import { ChatPage } from './pages/chat_page';
import { VoiceCapturePage } from './pages/voice_capture_page';

export function App() {
  return (
    <div className="app-shell">
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Navigate to="/notes" replace />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/notes/:id" element={<NoteDetailPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/voice" element={<VoiceCapturePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/notes" replace />} />
        </Routes>
      </main>
    </div>
  );
}
