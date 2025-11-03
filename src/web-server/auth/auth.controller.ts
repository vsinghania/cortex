import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { RateLimitMiddleware } from '../../common/middlewares/rate_limit.js';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { AuthSvc } from '../../auth_svc/auth_svc.js';
import { REFRESH_COOKIE_NAME, TokenUtils } from '../../auth_svc/utils/token_utils.js';

const EmailSchema = z.string().email();
const PasswordSchema = z.string().min(8);



export class AuthController {

  private static refreshCookieOptions() {
    const secure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
    const domain = process.env.COOKIE_DOMAIN || undefined;
    const sameSite = (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none' | undefined) ?? 'lax';
    return {
      httpOnly: true,
      secure,
      sameSite,
      domain,
      path: '/',
      maxAge: TokenUtils.refreshTokenTtlSec() * 1000
    } as const;
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
  }

  @validateRequest({ body: z.object({ email: EmailSchema, password: PasswordSchema }) })
  private async register(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const auth_svc = await AuthSvc.create();
      const result = await auth_svc.register(
        { email, password },
        { ip: req.ip, user_agent: AuthController.userAgent(req) }
      );

      // Set refresh token cookie, do not expose it in response body
      const opts = AuthController.refreshCookieOptions();
      res.cookie(REFRESH_COOKIE_NAME, result.tokens.refresh_token, opts);

      res.status(201).json({
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
      const result = await auth_svc.refresh(refresh_token ?? '', {
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
}
