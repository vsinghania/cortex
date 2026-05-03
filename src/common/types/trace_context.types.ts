export interface TraceStore {
  trace_id: string;
  user_id?: string;
  upstream_trace_id?: string;
  kind?: 'http' | 'bg';
}
