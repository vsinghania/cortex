import express from 'express';
import { z } from 'zod';
import { AppLinks } from '../../auth_svc/app_links.js';
import { ServiceUnavailableError } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import { RequireAuthMiddleware } from '../../common/middlewares/require_auth.js';
import { SecretBox } from '../../lib/crypto/secret_box.js';
import { Time } from '../../lib/time.js';
import { OneNoteConnectionSvc } from '../../onenote_svc/onenote_connection_svc.js';
import { CookieOptions } from '../cookie_options.js';

const STATE_COOKIE_NAME = 'ms_oauth';
const STATE_COOKIE_PATH = '/api/v1/integrations/onenote';
const STATE_TTL_MS = Time.minutesToMs(10);
const STATE_FIELD = 'onenote_oauth_state';
/** There is no per-user binding to seal against yet; the field name is the whole scope. */
const STATE_SCOPE = 'pending';

/**
 * The callback is a plain browser navigation, so it carries no bearer token and the
 * cookie is the only thing that says whose connection this is. Sealed rather than
 * JSON, so it cannot be forged: a planted cookie naming someone else's user_id would
 * otherwise route the victim's OneNote into the attacker's account.
 */
const PendingStateSchema = z.object({
  state: z.string().min(1),
  code_verifier: z.string().min(1),
  user_id: z.string().min(1)
});

type PendingState = z.infer<typeof PendingStateSchema>;

export class OneNoteController {
  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    this.router.post('/start', RequireAuthMiddleware.requireAuth, this.start.bind(this));
    this.router.get('/callback', this.callback.bind(this));
    this.router.get('/status', RequireAuthMiddleware.requireAuth, this.status.bind(this));
    this.router.delete('/', RequireAuthMiddleware.requireAuth, this.disconnect.bind(this));
  }

  private static stateCookieOptions() {
    return CookieOptions.oauthState({ path: STATE_COOKIE_PATH, max_age_ms: STATE_TTL_MS });
  }

  private static readPendingState(req: express.Request): PendingState | null {
    const sealed = (req as any).cookies?.[STATE_COOKIE_NAME] as string | undefined;
    if (!sealed) return null;

    try {
      const opened = SecretBox.fromEnv().open(sealed, { user_id: STATE_SCOPE, field: STATE_FIELD });
      const parsed = PendingStateSchema.safeParse(JSON.parse(opened));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Answers with the URL rather than redirecting: the SPA calls this with its bearer
   * token and then navigates itself, which is how the callback can know the user.
   */
  private async start(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const user_id = req.auth!.user_id;
      // Missing encryption keys would otherwise surface as an opaque 500 from SecretBox.
      if (!OneNoteConnectionSvc.isConfigured()) {
        throw new ServiceUnavailableError('OneNote is not configured');
      }

      const onenote_svc = await OneNoteConnectionSvc.create();
      const { url, pending } = await onenote_svc.startAuthorization();

      const sealed = SecretBox.fromEnv().seal(JSON.stringify({ ...pending, user_id }), {
        user_id: STATE_SCOPE,
        field: STATE_FIELD
      });
      res.cookie(STATE_COOKIE_NAME, sealed, OneNoteController.stateCookieOptions());

      res.status(200).json({ response: { url } });
    } catch (e) {
      next(e);
    }
  }

  // A browser navigation, so failures redirect back to the SPA rather than answering
  // with a problem document nobody would see.
  private async callback(req: express.Request, res: express.Response) {
    const links = AppLinks.fromEnv();
    const pending = OneNoteController.readPendingState(req);
    res.clearCookie(STATE_COOKIE_NAME, OneNoteController.stateCookieOptions());

    const { code, state, error } = req.query;
    if (typeof error === 'string') {
      logger.info({ reason: error }, 'onenote connect abandoned');
      res.redirect(links.settings({ error: error === 'access_denied' ? 'onenote_cancelled' : 'onenote_failed' }));
      return;
    }
    if (!pending || typeof code !== 'string' || typeof state !== 'string') {
      logger.warn({ reason: pending ? 'missing_code' : 'missing_state_cookie' }, 'onenote connect rejected');
      res.redirect(links.settings({ error: 'onenote_failed' }));
      return;
    }

    try {
      const onenote_svc = await OneNoteConnectionSvc.create();
      await onenote_svc.completeAuthorization({ user_id: pending.user_id, code, state, pending });
      res.redirect(links.settings({ connected: 'onenote' }));
    } catch (err) {
      logger.error({ err }, 'onenote connect failed');
      res.redirect(links.settings({ error: 'onenote_failed' }));
    }
  }

  private async status(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const available = OneNoteConnectionSvc.isConfigured();
      if (!available) {
        res.status(200).json({ response: { available, connection: null } });
        return;
      }

      const onenote_svc = await OneNoteConnectionSvc.create();
      const connection = await onenote_svc.getConnection(req.auth!.user_id);
      res.status(200).json({ response: { available, connection } });
    } catch (e) {
      next(e);
    }
  }

  private async disconnect(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const onenote_svc = await OneNoteConnectionSvc.create();
      const disconnected = await onenote_svc.disconnect(req.auth!.user_id);
      res.status(200).json({ response: { disconnected } });
    } catch (e) {
      next(e);
    }
  }
}
