export type AgentIdExists = (agent_id: string) => Promise<boolean>;

export class AgentIdGenerator {
  private static readonly fallback_base = 'agent';

  private constructor() {}

  static buildBase(name: string): string {
    const base = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return base.length > 0 ? base : AgentIdGenerator.fallback_base;
  }

  static async generateAvailable(name: string, exists: AgentIdExists): Promise<string> {
    const base = AgentIdGenerator.buildBase(name);
    let candidate = base;
    let suffix = 2;

    while (await exists(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }
}
