/** The event assistant's stream, read off a POST.
 *
 *  `EventSource` is the obvious tool and cannot be used: it is GET-only and
 *  cannot carry an Authorization header, and the question plus its history is a
 *  body, not a query string. So this reads the same wire format off a normal
 *  fetch — which is a dozen lines and keeps the bearer token out of a URL, where
 *  it would end up in logs.
 */

import { API_BASE_URL } from "@/lib/api";
import { getToken } from "@/lib/session";

export type AskEvent =
  | { kind: "planning" }
  | { kind: "queries"; names: string[] }
  | { kind: "token"; text: string }
  | { kind: "clarify"; question: string; isStub: boolean }
  | { kind: "refusal"; message: string; isStub: boolean }
  | { kind: "done"; proposalId: string; queries: string[]; isStub: boolean }
  | { kind: "error"; message: string };

export type Turn = { role: "user" | "assistant"; content: string };

/** Coerce an unknown field into a string list, dropping anything that is not a
 *  string. These arrive from the network, so a cast would be a lie the renderer
 *  pays for — `names.join()` on a number crashes the drawer. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Turn one `event:`/`data:` block into the union above.
 *
 *  Unknown event names are dropped rather than thrown on, so adding a
 *  thirteenth event server-side never breaks a browser that has not reloaded.
 */
function decode(name: string, data: Record<string, unknown>): AskEvent | null {
  switch (name) {
    case "planning":
      return { kind: "planning" };
    case "queries":
      return { kind: "queries", names: stringList(data.names) };
    case "token":
      return { kind: "token", text: String(data.text ?? "") };
    case "clarify":
      return {
        kind: "clarify",
        question: String(data.question ?? ""),
        isStub: Boolean(data.is_stub),
      };
    case "refusal":
      return {
        kind: "refusal",
        message: String(data.message ?? ""),
        isStub: Boolean(data.is_stub),
      };
    case "done":
      return {
        kind: "done",
        proposalId: String(data.proposal_id ?? ""),
        queries: stringList(data.queries),
        isStub: Boolean(data.is_stub),
      };
    case "error":
      return { kind: "error", message: String(data.message ?? "Something went wrong.") };
    default:
      return null;
  }
}

export async function askStream(
  eventId: string,
  body: { question: string; history: Turn[] },
  onEvent: (event: AskEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getToken();
  // API_BASE_URL already carries the /v1, exactly as `authed()` assumes.
  const response = await fetch(`${API_BASE_URL}/events/${eventId}/ai/ask`, {
    method: "POST",
    credentials: "include",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok || response.body === null) {
    // A failure before the stream opens is an ordinary status code — role
    // refusals and rate limits both land here — so it is reported as an error
    // event and the caller has one path to render instead of two.
    const detail = await response.json().catch(() => null);
    onEvent({
      kind: "error",
      message: detail?.error?.message ?? "The assistant is unavailable right now.",
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  /* A chunk boundary lands mid-event often enough to matter, so completed
     blocks are taken off the front and the remainder is carried forward. */
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let name: string | null = null;
      let data: Record<string, unknown> = {};
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) name = line.slice(7);
        else if (line.startsWith("data: ")) {
          try {
            data = JSON.parse(line.slice(6)) as Record<string, unknown>;
          } catch {
            data = {};
          }
        }
      }
      const parsed = name === null ? null : decode(name, data);
      if (parsed !== null) onEvent(parsed);
      split = buffer.indexOf("\n\n");
    }
  }
}
