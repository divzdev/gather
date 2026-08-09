"use client";

import { ApiError, apiFetch } from "@/lib/api";

const TOKEN_KEY = "gather.token";
const EVENT_KEY = "gather.event";

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export function setEventId(id: string): void {
  window.localStorage.setItem(EVENT_KEY, id);
}

export function getEventId(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(EVENT_KEY);
}

/** Access tokens last 15 minutes, so a console left open outlives them. One
 *  refresh runs at a time: a dashboard fires several queries at once and they
 *  would otherwise each spend the single-use refresh token, logging the user
 *  out mid-session. */
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const { access_token } = await apiFetch<{ access_token: string }>("/auth/refresh", {
        method: "POST",
      });
      setToken(access_token);
      return access_token;
    } catch {
      clearToken();
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Every console request goes through here so the bearer token is attached once. */
export async function authed<T>(
  path: string,
  options: Parameters<typeof apiFetch>[1] = {},
): Promise<T> {
  const send = (token: string | null) =>
    apiFetch<T>(path, {
      ...options,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    });

  try {
    return await send(getToken());
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const token = await refreshAccessToken();
    if (token === null) throw error;
    return send(token);
  }
}
