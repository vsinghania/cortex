import { Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/dm-sans/300.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/300-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { AppRoutes } from './lib/app_routes';
import { useTheme } from './lib/use_theme';
import { useIsMobile } from './lib/use_is_mobile';
import { ToastProvider } from './components/toast';
import { RequireAuth } from './components/require_auth';
import { LoginPage } from './pages/login_page';
import { RegisterPage } from './pages/register_page';
import { ForgotPasswordPage } from './pages/forgot_password_page';
import { ResetPasswordPage } from './pages/reset_password_page';
import { VerifyEmailPage } from './pages/verify_email_page';
import { NotesPage } from './pages/notes_page';
import { AssistantPage } from './pages/assistant_page';

export function App() {
  const theme = useTheme();
  const is_mobile = useIsMobile();

  return (
    <div className="cx-app" data-theme={theme} data-layout={is_mobile ? 'mobile' : 'desktop'}>
      <ToastProvider>
        <Routes>
          <Route path={AppRoutes.login()} element={<LoginPage />} />
          <Route path={AppRoutes.register()} element={<RegisterPage />} />
          <Route path={AppRoutes.forgotPassword()} element={<ForgotPasswordPage />} />
          <Route path={AppRoutes.resetPassword()} element={<ResetPasswordPage />} />
          <Route path={AppRoutes.verifyEmail()} element={<VerifyEmailPage />} />
          <Route element={<RequireAuth />}>
            {/* Optional segments keep one mounted page while the selection changes. */}
            <Route path="/notes/:note_id?" element={<NotesPage />} />
            <Route path="/chat/:conversation_id?" element={<AssistantPage />} />
            <Route path="/voice" element={<Navigate to={AppRoutes.chat({ mode: 'voice' })} replace />} />
          </Route>
          <Route path="*" element={<Navigate to={AppRoutes.notes()} replace />} />
        </Routes>
      </ToastProvider>
    </div>
  );
}
