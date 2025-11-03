export type HttpErrorDetails = Record<string, unknown>;

export class HttpError<TDetails extends HttpErrorDetails = HttpErrorDetails> extends Error {
  readonly status_code: number;
  readonly error_code: string;
  readonly details?: TDetails;
  readonly cause?: unknown;
  readonly headers?: Record<string, string>; // extra response headers (Retry-After, WWW-Authenticate, etc.)

  constructor(
    status_code: number,
    error_code: string,
    message?: string,
    opts?: {
      details?: TDetails;
      cause?: unknown;
      headers?: Record<string, string>;
    }
  ) {
    super(message ?? error_code);
    this.name = this.constructor.name;
    this.status_code = status_code;
    this.error_code = error_code;
    this.details = opts?.details;
    this.cause = opts?.cause;
    this.headers = opts?.headers;

    // V8-only guard
    if (typeof (Error as any).captureStackTrace === "function") {
      (Error as any).captureStackTrace(this, this.constructor);
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** RFC7807 Problem Details JSON (https://datatracker.ietf.org/doc/html/rfc7807) */
  toJSON(reqUrl?: string) {
    return {
      type: `${this.error_code}`,
      title: this.error_code.replace(/_/g, " "),
      status: this.status_code,
      detail: this.message,
      instance: reqUrl,
      ...(this.details ? { details: this.details } : {})
    };
  }

  static isHttpError(err: unknown): err is HttpError {
    return err instanceof HttpError || (typeof err === "object" && !!err && "status_code" in err && "error_code" in err);
  }

  static toResponse(err: Error, reqUrl?: string) {
    const e = HttpError.isHttpError(err)
      ? err
      : new InternalServerError("An unexpected error occurred", { cause: err });
    return {
      http_error: e,
      status: e.status_code,
      body: e.toJSON(reqUrl),
      headers: { "content-type": "application/problem+json", ...(e.headers ?? {}) }
    };
  }
}

export class BadRequestError<T extends HttpErrorDetails = HttpErrorDetails> extends HttpError<T> {
  constructor(message = "Bad request", opts?: { details?: T; cause?: unknown }) {
    super(400, "bad_request", message, opts);
  }
}

export class NotFoundError<T extends HttpErrorDetails = HttpErrorDetails> extends HttpError<T> {
  constructor(message = "Resource not found", opts?: { details?: T; cause?: unknown }) {
    super(404, "not_found", message, opts);
  }
}

export class ConflictError<T extends HttpErrorDetails = HttpErrorDetails> extends HttpError<T> {
  constructor(message = "Conflict", opts?: { details?: T; cause?: unknown }) {
    super(409, "conflict", message, opts);
  }
}

export class InternalServerError<T extends HttpErrorDetails = HttpErrorDetails> extends HttpError<T> {
  constructor(message = "Internal Server Error", opts?: { details?: T; cause?: unknown }) {
    super(500, "internal_server_error", message, opts);
  }
}

export class ValidationError<T extends HttpErrorDetails = HttpErrorDetails> extends HttpError<T> {
  constructor(message = "Validation failed", opts?: { details?: T; cause?: unknown }) {
    super(400, "validation_error", message, opts);
  }
}

export class UnauthorizedError<T extends HttpErrorDetails = HttpErrorDetails> extends HttpError<T> {
  constructor(
    message = "Unauthorized",
    opts?: { details?: T; cause?: unknown; headers?: Record<string, string> }
  ) {
    super(401, "unauthorized", message, opts);
  }
}

export class ForbiddenError<T extends HttpErrorDetails = HttpErrorDetails> extends HttpError<T> {
  constructor(message = "Forbidden", opts?: { details?: T; cause?: unknown }) {
    super(403, "forbidden", message, opts);
  }
}

export class ServiceUnavailableError<T extends HttpErrorDetails = HttpErrorDetails> extends HttpError<T> {
  constructor(message = "Service Unavailable", opts?: { details?: T; cause?: unknown }) {
    super(503, "service_unavailable", message, opts);
  }
}
