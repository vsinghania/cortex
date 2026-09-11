import type { AgentManifest } from './types/agent.types.js';
import { AgentLoadStatus, type AgentView } from './types/agent_view.types.js';
import type { BaseAgent } from './agents/base_agent.js';

export class AgentViewBuilder {
  private constructor() {}

  /** `loaded` is the registry's instance for this manifest, if it has one. */
  static build(manifest: AgentManifest, loaded: BaseAgent | undefined): AgentView {
    return {
      manifest,
      status: AgentViewBuilder.statusOf(manifest, loaded),
      runtime: loaded ? loaded.describeRuntime() : null,
    };
  }

  // Registry presence wins over `enabled`: a row disabled directly in Mongo keeps
  // serving until the next refresh, and the status should say so.
  private static statusOf(manifest: AgentManifest, loaded: BaseAgent | undefined): AgentLoadStatus {
    if (loaded) return AgentLoadStatus.Loaded;
    return manifest.enabled ? AgentLoadStatus.NotLoaded : AgentLoadStatus.Disabled;
  }
}
