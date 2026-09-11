export enum InstructionPolicyName {
  OutputHygiene = 'output_hygiene',
  Confidentiality = 'confidentiality',
  UntrustedContent = 'untrusted_content',
  Grounding = 'grounding',
  Citations = 'citations',
  WriteSafety = 'write_safety',
}

/**
 * A reusable block of agent instructions (a behavioural gate) that manifests opt into by
 * name via `instruction_policy_names`. Appended after the agent's own instructions.
 */
export interface InstructionPolicy {
  readonly name: InstructionPolicyName;
  readonly title: string;
  body(): string;
}
