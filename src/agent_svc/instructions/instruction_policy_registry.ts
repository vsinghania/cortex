import type { InstructionPolicy } from '../types/instruction_policy.types.js';
import { NotFoundError } from '../../common/errors.js';
import { OutputHygienePolicy } from './policies/output_hygiene_policy.js';
import { ConfidentialityPolicy } from './policies/confidentiality_policy.js';
import { UntrustedContentPolicy } from './policies/untrusted_content_policy.js';
import { GroundingPolicy } from './policies/grounding_policy.js';
import { CitationsPolicy } from './policies/citations_policy.js';
import { WriteSafetyPolicy } from './policies/write_safety_policy.js';

export class InstructionPolicyRegistry {
  private static instance: InstructionPolicyRegistry | null = null;

  private policies = new Map<string, InstructionPolicy>();

  private constructor() {}

  static getInstance(): InstructionPolicyRegistry {
    if (InstructionPolicyRegistry.instance) return InstructionPolicyRegistry.instance;
    const registry = new InstructionPolicyRegistry();
    registry.registerBuiltins();
    InstructionPolicyRegistry.instance = registry;
    return registry;
  }

  /**
   * Returns the named policies in registration order, deduped, so the composed prompt is
   * the same however a manifest orders its names.
   */
  resolveAll(names: string[]): InstructionPolicy[] {
    const missing = names.filter((name) => !this.policies.has(name));
    if (missing.length) {
      throw new NotFoundError(`Unknown instruction policy(s): ${missing.join(', ')}`);
    }
    const requested = new Set(names);
    return this.list().filter((policy) => requested.has(policy.name));
  }

  list(): InstructionPolicy[] {
    return Array.from(this.policies.values());
  }

  private register(policy: InstructionPolicy): void {
    if (this.policies.has(policy.name)) {
      throw new Error(`Instruction policy already registered: ${policy.name}`);
    }
    this.policies.set(policy.name, policy);
  }

  private registerBuiltins(): void {
    this.register(new OutputHygienePolicy());
    this.register(new ConfidentialityPolicy());
    this.register(new UntrustedContentPolicy());
    this.register(new GroundingPolicy());
    this.register(new CitationsPolicy());
    this.register(new WriteSafetyPolicy());
  }
}
