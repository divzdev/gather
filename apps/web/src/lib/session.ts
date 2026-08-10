"use client";

import { API_BASE_URL, ApiError, apiFetch } from "@/lib/api";

const TOKEN_KEY = "gather.token";
const EVENT_KEY = "gather.event";
/** Kept apart from the staff token on purpose: an organiser previewing the
 *  portal must not have their console session replaced by a speaker's. */
const SPEAKER_KEY = "gather.speaker";

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

export function setSpeakerToken(token: string): void {
  window.localStorage.setItem(SPEAKER_KEY, token);
}

export function getSpeakerToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(SPEAKER_KEY);
}

export function clearSpeakerToken(): void {
  window.localStorage.removeItem(SPEAKER_KEY);
}

/** A speaker session is a single long-lived token from a magic link. There is no
 *  refresh cookie behind it, so an expiry means asking for a new link. */
export async function portal<T>(
  path: string,
  options: Parameters<typeof apiFetch>[1] = {},
): Promise<T> {
  const token = getSpeakerToken();
  return apiFetch<T>(`/portal${path}`, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
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

/** Download a file from an authenticated endpoint.
 *
 *  `window.open` cannot carry the bearer token, so every export that reached for
 *  it was quietly getting a 401 page instead of a file. Fetch it, then hand the
 *  browser a blob.
 *
 *  Passing `ids` makes it a POST — used where the caller exports exactly what is
 *  on screen and the list is too long for a URL.
 */
export async function download(
  path: string,
  filename: string,
  ids?: readonly string[],
): Promise<void> {
  const request = (token: string | null): Promise<Response> =>
    fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      ...(ids === undefined
        ? {}
        : {
            method: "POST",
            body: JSON.stringify({ submission_ids: ids }),
          }),
      headers: {
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        ...(ids === undefined ? {} : { "Content-Type": "application/json" }),
      },
    });

  let response = await request(getToken());
  if (response.status === 401) {
    const token = await refreshAccessToken();
    if (token !== null) response = await request(token);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined;
    throw new Error(body?.error?.message ?? `Could not build ${filename}.`);
  }

  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
