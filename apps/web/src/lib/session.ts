"use client";

import { apiFetch } from "@/lib/api";

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

/** Every console request goes through here so the bearer token is attached once. */
export async function authed<T>(
  path: string,
  options: Parameters<typeof apiFetch>[1] = {},
): Promise<T> {
  const token = getToken();
  return apiFetch<T>(path, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
}
