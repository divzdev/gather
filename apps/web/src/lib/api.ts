/**
 * The single way the frontend talks to the API.
 *
 * Response shapes come from `api-types.ts`, which `make types` generates from the
 * FastAPI OpenAPI schema. Never hand-write a type describing a response — that is
 * how the two halves drift.
 */

/** Same-origin in the browser: next.config.ts rewrites /api/v1 to the API
 *  service, which keeps the refresh cookie in play and makes CORS unnecessary.
 *
 *  Server components have no origin to resolve a relative URL against, and the
 *  rewrite lives in the very server doing the rendering — so they call the API
 *  directly. Public pages are server-rendered, so getting this wrong 500s the
 *  entire public surface. */
export const API_BASE_URL =
  typeof window === "undefined"
    ? `${process.env.API_ORIGIN ?? "http://127.0.0.1:8051"}/v1`
    : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1");

/** Mirrors the API error envelope: {error: {code, message, details, field}}. */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    field?: string;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody | undefined, fallback: string) {
    super(body?.error?.message ?? fallback);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error?.code ?? "UNKNOWN";
    this.field = body?.error?.field;
    this.details = body?.error?.details;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  /** Required by the API on retryable mutations: send, publish, push, bulk ops. */
  idempotencyKey?: string;
};

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, headers, ...rest } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    // A proxy or crash can return non-JSON; the error envelope must still hold.
    const parsed = (await response.json().catch(() => undefined)) as
      | ApiErrorBody
      | undefined;
    throw new ApiError(response.status, parsed, `${response.status} ${response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
