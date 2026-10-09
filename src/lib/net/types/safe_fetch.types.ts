export type ResolvedAddress = { address: string; family: 4 | 6 };

export type SafeFetchTarget = {
  hostname: string;
  /** The vetted address the connection must go to: never re-resolved, so DNS cannot change it in between. */
  address: ResolvedAddress;
  path: string;
  timeout_ms: number;
  max_bytes: number;
};

export type SafeFetchResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export type SafeFetcherOptions = {
  timeout_ms?: number;
  max_bytes?: number;
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  send?: (target: SafeFetchTarget) => Promise<SafeFetchResponse>;
};
