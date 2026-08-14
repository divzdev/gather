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

/** Leave for `destination` with a document load, not a client-side push. Use at
 *  every point where *who is signed in* changes: sign-in, sign-out, account
 *  switch.
 *
 *  `router.push` keeps the React tree and the TanStack Query cache alive across
 *  the switch, and both are keyed to who you *were*. `["me"]` carries a
 *  five-minute `staleTime`, so signing in as a reviewer while an owner's answer
 *  is still warm renders the owner's name, counts and console under the
 *  reviewer's token; going the other way, a stale `role: "reviewer"` bounces a
 *  genuine organizer to /review on every link they press. The token in
 *  localStorage was correct in both cases — the screen was reading a memory.
 *
 *  Clearing the query cache would fix `["me"]`, but only the caches someone
 *  remembered to clear, at each of the four sign-in paths. A document load drops
 *  every cache there is, including component state and the undo stack, which is
 *  the guarantee an identity change actually needs.
 *
 *  Not for token *refresh* — that renews the same identity, and reloading the
 *  page under a user every fifteen minutes would be its own bug.
 */
export function restartAt(destination: string): void {
  window.location.assign(destination);
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

/** An authenticated file as an object URL, for showing rather than saving.
 *
 *  An `<img src>` cannot carry the bearer token, so a headshot pointed straight
 *  at the download route renders as a broken image — the request comes back 401
 *  and the tag has no way to say so. Fetching the bytes first is the only way to
 *  put an authenticated image on screen.
 */
export async function blobUrl(path: string): Promise<string> {
  const request = (token: string | null): Promise<Response> =>
    fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    });

  let response = await request(getToken());
  if (response.status === 401) {
    const token = await refreshAccessToken();
    if (token !== null) response = await request(token);
  }
  if (!response.ok) throw new Error("That image could not be loaded.");
  return URL.createObjectURL(await response.blob());
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
  if (!response.ok) throw await failure(response, filename);
  await save(response, filename);
}

/** Download from a speaker-token endpoint.
 *
 *  The portal's "Download .ics" was a `window.open`, which is a top-level
 *  navigation and carries no Authorization header — so the button opened a
 *  NOT_AUTHENTICATED page instead of saving a calendar entry. Exactly the
 *  failure `download` above exists to prevent, on the other of the two tokens.
 *
 *  No 401 retry, unlike the staff path: a speaker session is one long-lived
 *  token from a magic link with no refresh cookie behind it, so an expiry means
 *  asking for a new link rather than silently renewing.
 */
export async function portalDownload(path: string, filename: string): Promise<void> {
  const response = await portalFetch(path);
  if (!response.ok) throw await failure(response, filename);
  await save(response, filename);
}

/** A speaker's own file as an object URL, for showing rather than saving — the
 *  `blobUrl` above on the other token. The portal needs it for one thing: a
 *  headshot the speaker just uploaded, which their own token can read but no
 *  public route will serve until the programme is published. */
export async function portalBlobUrl(path: string): Promise<string> {
  const response = await portalFetch(path);
  if (!response.ok) throw await failure(response, "that image");
  return URL.createObjectURL(await response.blob());
}

function portalFetch(path: string): Promise<Response> {
  const token = getSpeakerToken();
  return fetch(`${API_BASE_URL}/portal${path}`, {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  });
}

async function failure(response: Response, filename: string): Promise<Error> {
  const body = (await response.json().catch(() => undefined)) as
    { error?: { message?: string } } | undefined;
  return new Error(body?.error?.message ?? `Could not build ${filename}.`);
}

async function save(response: Response, filename: string): Promise<void> {
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
