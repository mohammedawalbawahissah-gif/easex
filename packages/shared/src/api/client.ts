import type { TokenStorage } from "./tokenStorage";

export interface ApiClientConfig {
  baseUrl: string;
  tokenStorage: TokenStorage;
  /** Called when refresh fails and the user must log in again. */
  onAuthExpired?: () => void;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * A single fetch wrapper shared by web and mobile. This is the
 * ONE place request/auth/retry logic lives — every screen on
 * both platforms calls through this, so behavior (auth headers,
 * refresh-on-401, error shape) is identical everywhere by
 * construction, not by convention.
 */
export function createApiClient(config: ApiClientConfig) {
  const { baseUrl, tokenStorage, onAuthExpired } = config;

  async function refreshAccessToken(): Promise<string | null> {
    const refresh = await tokenStorage.getRefreshToken();
    if (!refresh) return null;

    const res = await fetch(`${baseUrl}/api/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });

    if (!res.ok) {
      await tokenStorage.clearTokens();
      onAuthExpired?.();
      return null;
    }

    const data = await res.json();
    await tokenStorage.setTokens(data.access, refresh);
    return data.access as string;
  }

  async function request<T>(
    path: string,
    options: RequestInit = {},
    _retrying = false
  ): Promise<T> {
    const access = await tokenStorage.getAccessToken();

    const headers = new Headers(options.headers);
    if (access) headers.set("Authorization", `Bearer ${access}`);
    if (!(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`${baseUrl}${path}`, { ...options, headers });

    // Access token expired mid-session — refresh once and retry,
    // never loop indefinitely.
    if (res.status === 401 && !_retrying) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return request<T>(path, options, true);
      }
    }

    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON error body, ignore */
      }
      throw new ApiError(res.status, body);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>(path, { method: "GET" }),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, {
        method: "POST",
        body: body instanceof FormData ? body : JSON.stringify(body),
      }),
    put: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
    patch: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
