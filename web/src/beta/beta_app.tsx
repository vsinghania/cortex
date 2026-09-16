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
import './beta.css';
import { BetaRoutes } from './lib/beta_routes';
import { useTheme } from './lib/use_theme';
import { useIsMobile } from './lib/use_is_mobile';
import { ToastProvider } from './components/toast';
import { BetaRequireAuth } from './components/beta_require_auth';
import { BetaLoginPage } from './pages/login_page';
import { BetaRegisterPage } from './pages/register_page';
import { BetaForgotPasswordPage } from './pages/forgot_password_page';
import { BetaResetPasswordPage } from './pages/reset_password_page';
import { BetaVerifyEmailPage } from './pages/verify_email_page';
import { NotesPage } from './pages/notes_page';
import { AssistantPage } from './pages/assistant_page';

export function BetaApp() {
  const theme = useTheme();
  const is_mobile = useIsMobile();

  return (
    <div className="cx-beta" data-theme={theme} data-layout={is_mobile ? 'mobile' : 'desktop'}>
      <ToastProvider>
        <Routes>
          <Route path={BetaRoutes.login()} element={<BetaLoginPage />} />
          <Route path={BetaRoutes.register()} element={<BetaRegisterPage />} />
          <Route path={BetaRoutes.forgotPassword()} element={<BetaForgotPasswordPage />} />
          <Route path={BetaRoutes.resetPassword()} element={<BetaResetPasswordPage />} />
          <Route path={BetaRoutes.verifyEmail()} element={<BetaVerifyEmailPage />} />
          <Route element={<BetaRequireAuth />}>
            {/* Optional segments keep one mounted page while the selection changes. */}
            <Route path="/notes/:note_id?" element={<NotesPage />} />
            <Route path="/chat/:conversation_id?" element={<AssistantPage />} />
            <Route path="/voice" element={<Navigate to={BetaRoutes.chat({ mode: 'voice' })} replace />} />
          </Route>
          <Route path="*" element={<Navigate to={BetaRoutes.notes()} replace />} />
        </Routes>
      </ToastProvider>
    </div>
  );
}
