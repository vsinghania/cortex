type RealtimeEvent = {
  type: string;
  [key: string]: unknown;
};

/**
 * The Realtime API does not respond on its own once MCP calls finish: `response.done` can
 * arrive before the calls complete, and the client must send `response.create` afterwards
 * for the model to speak about the results. This decides when that follow-up is due.
 */
export class RealtimeFollowUpTracker {

  private readonly pending_calls = new Set<string>();
  private has_unreported_results = false;
  private response_active = false;

  /** Returns true when the caller should send `response.create` now. */
  public observe(event: RealtimeEvent): boolean {
    this.apply(event);
    if (!this.isFollowUpDue()) return false;
    this.has_unreported_results = false;
    this.response_active = true;
    return true;
  }

  private apply(event: RealtimeEvent): void {
    switch (event.type) {
      case 'response.created':
        this.response_active = true;
        this.has_unreported_results = false;
        return;
      case 'response.done':
        this.response_active = false;
        return;
      case 'response.output_item.added': {
        const call_id = RealtimeFollowUpTracker.mcpCallItemId(event);
        if (call_id) this.pending_calls.add(call_id);
        return;
      }
      case 'response.output_item.done': {
        const call_id = RealtimeFollowUpTracker.mcpCallItemId(event);
        if (call_id) this.settleCall(call_id);
        return;
      }
      case 'response.mcp_call.failed': {
        if (typeof event.item_id === 'string') this.settleCall(event.item_id);
        return;
      }
      default:
        return;
    }
  }

  // A failed call can be reported by both `mcp_call.failed` and `output_item.done`; only
  // the first settles it, or the second would trigger a duplicate follow-up.
  private settleCall(call_id: string): void {
    if (!this.pending_calls.delete(call_id)) return;
    this.has_unreported_results = true;
  }

  private isFollowUpDue(): boolean {
    return !this.response_active && this.pending_calls.size === 0 && this.has_unreported_results;
  }

  private static mcpCallItemId(event: RealtimeEvent): string | null {
    const item = event.item;
    if (!item || typeof item !== 'object') return null;
    const { type, id } = item as Record<string, unknown>;
    return type === 'mcp_call' && typeof id === 'string' ? id : null;
  }
}
