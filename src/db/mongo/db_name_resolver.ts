export type ServiceKey = 'auth' | 'user' | 'notes' | 'quiz' | 'agent';

/**
 * DbNameResolver centralizes database name resolution per service.
 *
 * Resolution order:
 * 1) Explicit per-service env var: MONGO_DB_{SERVICE} (e.g., MONGO_DB_USER)
 *    - If set, used as-is (no suffix appended).
 * 2) Namespace-derived: MONGO_DB_NAMESPACE + _{service}_db (e.g., dev_user_db)
 * 3) Legacy app name: MONGO_DB_APP + _{service}_db (e.g., app_user_db)
 * 4) Default: {service}_db
 *
 * Notes:
 * - The _db suffix is always appended for namespace/app/default derived names.
 * - Explicit per-service env names are trusted verbatim so operators can control exact db names.
 */
export class DbNameResolver {
  private constructor() {}

  static resolve(service: ServiceKey): string {
    const env_key = `MONGO_DB_${service.toUpperCase()}`;
    const direct = (process.env as Record<string, string | undefined>)[env_key];
    if (direct && direct.trim().length > 0) return direct.trim();

    const namespace = process.env.MONGO_DB_NAMESPACE?.trim();
    if (namespace && namespace.length > 0) return `${namespace}_${service}_db`;

    const app = process.env.MONGO_DB_APP?.trim();
    if (app && app.length > 0) return `${app}_${service}_db`;

    return `${service}_db`;
  }
}
