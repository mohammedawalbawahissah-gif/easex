import { ApiError } from "../api/client";

/**
 * Turn whatever a request threw into one sentence for the user. The payments
 * endpoints reply `{ detail, code }`; DRF field validation replies
 * `{ field: ["msg"] }`; anything else gets the fallback.
 */
export function apiErrorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiError && err.body && typeof err.body === "object") {
    const body = err.body as Record<string, unknown>;
    if (typeof body.detail === "string") return body.detail;
    for (const value of Object.values(body)) {
      if (typeof value === "string") return value;
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return fallback;
}

/** The machine-readable `code` from a payments error, if it has one. */
export function apiErrorCode(err: unknown): string | null {
  if (err instanceof ApiError && err.body && typeof err.body === "object") {
    const code = (err.body as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return null;
}
