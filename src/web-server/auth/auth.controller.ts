import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { RateLimitMiddleware } from '../../common/middlewares/rate_limit.js';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { AuthSvc } from '../../auth_svc/auth_svc.js';
import { PasswordResetSvc } from '../../auth_svc/password_reset_svc.js';
import { EmailVerificationSvc } from '../../auth_svc/email_verification_svc.js';
import { GoogleAuthSvc } from '../../auth_svc/google_auth_svc.js';
import { AppLinks } from '../../auth_svc/app_links.js';
import type { GoogleOAuthState } from '../../auth_svc/types/google_auth.types.js';
import { logger } from '../../common/logger.js';
import { REFRESH_COOKIE_NAME } from '../../auth_svc/utils/token_utils.js';
import { CookieOptions } from '../cookie_options.js';
import { Time } from '../../lib/time.js';

const EmailSchema = z.string().email();
const PasswordSchema = z.string().min(8);
const NameSchema = z.string().trim().min(1).max(100);
const EmailTokenSchema = z.string().min(1).max(512);
const GOOGLE_STATE_COOKIE_NAME = 'g_oauth';
const GOOGLE_STATE_COOKIE_PATH = '/api/v1/auth/google';
const GOOGLE_STATE_TTL_MS = Time.minutesToMs(10);
const GoogleOAuthStateSchema = z.object({
  state: z.string().min(1),
  code_verifier: z.string().min(1),
  return_to: z.string()
});



export class AuthController {

  private static refreshCookieOptions() {
    return CookieOptions.refresh();
  }

  private static googleStateCookieOptions() {
    return CookieOptions.oauthState({ path: GOOGLE_STATE_COOKIE_PATH, max_age_ms: GOOGLE_STATE_TTL_MS });
  }

  private static readGoogleState(req: express.Request): GoogleOAuthState | null {
    const raw = (req as any).cookies?.[GOOGLE_STATE_COOKIE_NAME] as string | undefined;
    if (!raw) return null;
    try {
      const parsed = GoogleOAuthStateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private static userAgent(req: express.Request) {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : undefined;
  }
  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    // rate limit auth endpoints
    this.router.use(RateLimitMiddleware.authRateLimiter);
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    this.router.post('/register', this.register.bind(this));
    this.router.post('/login', this.login.bind(this));
    this.router.post('/refresh', this.refresh.bind(this));
    this.router.post('/logout', this.logout.bind(this));
    this.router.get('/me', RequireAuthMiddleware.requireAuth, this.me.bind(this));
    this.router.get('/google/start', this.googleStart.bind(this));
    this.router.get('/google/callback', this.googleCallback.bind(this));
    this.router.post('/password/forgot', RateLimitMiddleware.emailSendRateLimiter, this.forgotPassword.bind(this));
    this.router.post('/password/reset', this.resetPassword.bind(this));
    this.router.post('/email/verify', this.verifyEmail.bind(this));
    this.router.post('/email/verify/request', RateLimitMiddleware.emailSendRateLimiter, this.requestVerification.bind(this));
    this.router.post(
      '/email/verify/resend',
      RequireAuthMiddleware.requireAuth,
      RateLimitMiddleware.emailSendRateLimiter,
      this.resendVerification.bind(this)
    );
  }

  @validateRequest({ body: z.object({ email: EmailSchema, name: NameSchema, password: PasswordSchema }) })
  private async register(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { email, name, password } = req.body as { email: string; name: string; password: string };
      const auth_svc = await AuthSvc.create();
      const result = await auth_svc.register({ email, name, password });
      // No session until the address is verified; the client signs in after clicking the link.
      res.status(201).json({ response: { user: result.user, verification_required: true } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ body: z.object({ email: EmailSchema, password: PasswordSchema }) })
  private async login(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const auth_svc = await AuthSvc.create();
      const result = await auth_svc.login(
        { email, password },
        { ip: req.ip, user_agent: AuthController.userAgent(req) }
      );

      const opts = AuthController.refreshCookieOptions();
      res.cookie(REFRESH_COOKIE_NAME, result.tokens.refresh_token, opts);

      res.status(200).json({
        response: {
          user: result.user,
          access_token: result.tokens.access_token,
          access_token_expires_in_sec: result.tokens.access_token_expires_in_sec
        }
      });
    } catch (e) {
      next(e);
    }
  }

  private async refresh(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      // Prefer cookie, fallback to body.refresh_token for manual clients
      const cookie_rt = (req as any).cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      const body_rt = (req.body as any)?.refresh_token as string | undefined;
      const refresh_token = cookie_rt || body_rt;
      const auth_svc = await AuthSvc.create();
      const result = await auth_svc.rotateRefreshSession(refresh_token ?? '', {
        ip: req.ip,
        user_agent: AuthController.userAgent(req)
      });

      const opts = AuthController.refreshCookieOptions();
      res.cookie(REFRESH_COOKIE_NAME, result.tokens.refresh_token, opts);

      res.status(200).json({
        response: {
          access_token: result.tokens.access_token,
          access_token_expires_in_sec: result.tokens.access_token_expires_in_sec
        }
      });
    } catch (e) {
      next(e);
    }
  }

  private async logout(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const cookie_rt = (req as any).cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      const body_rt = (req.body as any)?.refresh_token as string | undefined;
      const refresh_token = cookie_rt || body_rt;
      const auth_svc = await AuthSvc.create();
      const result = await auth_svc.logout(refresh_token ?? '');

      // Clear cookie (use same options to ensure browser matches)
      const opts = AuthController.refreshCookieOptions();
      res.clearCookie(REFRESH_COOKIE_NAME, opts);

      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ body: z.object({ email: EmailSchema }) })
  private async forgotPassword(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { email } = req.body as { email: string };
      const password_reset_svc = await PasswordResetSvc.create();
      await password_reset_svc.requestPasswordReset(email);
      // 202 whatever happened, so this endpoint cannot be used to probe which
      // emails have accounts.
      res.status(202).json({ response: { accepted: true } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ body: z.object({ token: EmailTokenSchema, password: PasswordSchema }) })
  private async resetPassword(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { token, password } = req.body as { token: string; password: string };
      const password_reset_svc = await PasswordResetSvc.create();
      await password_reset_svc.resetPassword({ token, new_password: password });

      // Every session was just revoked, this browser's included, so drop its dead cookie.
      res.clearCookie(REFRESH_COOKIE_NAME, AuthController.refreshCookieOptions());
      res.status(200).json({ response: { success: true } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ body: z.object({ token: EmailTokenSchema }) })
  private async verifyEmail(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { token } = req.body as { token: string };
      const email_verification_svc = await EmailVerificationSvc.create();
      await email_verification_svc.verifyEmailToken(token);
      res.status(200).json({ response: { success: true } });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({ body: z.object({ email: EmailSchema }) })
  private async requestVerification(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { email } = req.body as { email: string };
      const email_verification_svc = await EmailVerificationSvc.create();
      // 202 whatever happened, like forgot-password, so this cannot probe which emails
      // have accounts or which of them are verified.
      await email_verification_svc.requestVerificationForEmail(email);
      res.status(202).json({ response: { accepted: true } });
    } catch (e) {
      next(e);
    }
  }

  private async resendVerification(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const user_id = req.auth!.user_id;
      const email_verification_svc = await EmailVerificationSvc.create();
      // 202 either way: an already-verified account and a queued send look the same
      // to the caller, and the banner only needs to know the request was taken.
      await email_verification_svc.requestVerification(user_id);
      res.status(202).json({ response: { accepted: true } });
    } catch (e) {
      next(e);
    }
  }

  private async me(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const user_id = req.auth!.user_id;
      const auth_svc = await AuthSvc.create();
      const result = await auth_svc.getMe(user_id);
      res.status(200).json({ response: result });
    } catch (e) {
      next(e);
    }
  }

  // Both Google routes are browser navigations, so failures redirect back to the SPA's
  // login page instead of answering with a problem document nobody would see.
  private async googleStart(req: express.Request, res: express.Response) {
    const links = AppLinks.fromEnv();
    try {
      if (!GoogleAuthSvc.isConfigured()) {
        res.redirect(links.buildLoginErrorUrl('google_unavailable'));
        return;
      }
      const return_to = typeof req.query.return_to === 'string' ? req.query.return_to : undefined;
      const google_auth_svc = await GoogleAuthSvc.create();
      const { url, pending } = google_auth_svc.startAuthorization(return_to);
      res.cookie(GOOGLE_STATE_COOKIE_NAME, JSON.stringify(pending), AuthController.googleStateCookieOptions());
      res.redirect(url);
    } catch (err) {
      logger.error({ err }, 'google login start failed');
      res.redirect(links.buildLoginErrorUrl('google_failed'));
    }
  }

  private async googleCallback(req: express.Request, res: express.Response) {
    const links = AppLinks.fromEnv();
    const pending = AuthController.readGoogleState(req);
    res.clearCookie(GOOGLE_STATE_COOKIE_NAME, AuthController.googleStateCookieOptions());

    const { code, state, error } = req.query;
    if (typeof error === 'string') {
      logger.info({ reason: error }, 'google login abandoned');
      res.redirect(links.buildLoginErrorUrl(error === 'access_denied' ? 'google_cancelled' : 'google_failed'));
      return;
    }
    if (!pending || typeof code !== 'string' || typeof state !== 'string') {
      logger.warn({ reason: pending ? 'missing_code' : 'missing_state_cookie' }, 'google login rejected');
      res.redirect(links.buildLoginErrorUrl('google_failed'));
      return;
    }

    try {
      const google_auth_svc = await GoogleAuthSvc.create();
      const result = await google_auth_svc.completeAuthorization(
        { code, state, pending },
        { ip: req.ip, user_agent: AuthController.userAgent(req) }
      );
      res.cookie(REFRESH_COOKIE_NAME, result.tokens.refresh_token, AuthController.refreshCookieOptions());
      res.redirect(links.buildAppPathUrl(result.return_to));
    } catch (err) {
      logger.error({ err }, 'google login failed');
      res.redirect(links.buildLoginErrorUrl('google_failed'));
    }
  }
}
