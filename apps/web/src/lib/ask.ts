/** The event assistant's stream, read off a POST.
 *
 *  `EventSource` is the obvious tool and cannot be used: it is GET-only and
 *  cannot carry an Authorization header, and the question plus its history is a
 *  body, not a query string. So this reads the same wire format off a normal
 *  fetch — which is a dozen lines and keeps the bearer token out of a URL, where
 *  it would end up in logs.
 */

import { API_BASE_URL } from "@/lib/api";
import { authed, getToken } from "@/lib/session";
import type { components } from "@/lib/api-types";

/** What is answering, and what today has cost. Read before a question is asked
 *  — "which model is this running on?" should not require spending a question
 *  to find out. */
export type AiStatus = components["schemas"]["AiStatus"];

export function fetchAiStatus(eventId: string): Promise<AiStatus> {
  return authed<AiStatus>(`/events/${eventId}/ai/status`);
}

/** One change the assistant is offering to make. Inert until applied: this is a
 *  description of a row, not a row. */
export type ProposedAction = {
  index: number;
  /** Catalog action name, e.g. `create_room`. */
  name: string;
  verb: "create" | "update";
  /** "room", "track" — how the card names it. */
  resource: string;
  /** The setup screens' query key, so applying can refresh them. */
  collection: string;
  /** The existing row this edits, resolved to its real name. Null on a create. */
  target: string | null;
  /** What those fields hold today, for the `60 → 80` arrow. */
  before: Record<string, unknown>;
  /** Only the fields that will actually be set. */
  values: Record<string, unknown>;
  status: "proposed" | "applied" | "failed";
  label?: string | null;
  error?: string | null;
};

export type AskEvent =
  | { kind: "planning" }
  | { kind: "model"; name: string; provider: string; isStub: boolean }
  | { kind: "resolving"; target: string }
  | {
      kind: "proposal";
      proposalId: string;
      actions: ProposedAction[];
      isStub: boolean;
      run: RunStats;
    }
  | { kind: "queries"; names: string[] }
  | { kind: "token"; text: string }
  | { kind: "clarify"; question: string; isStub: boolean; run: RunStats }
  | { kind: "refusal"; message: string; isStub: boolean; run: RunStats }
  | {
      kind: "done";
      proposalId: string;
      queries: string[];
      isStub: boolean;
      model: string | null;
      /** Planning call only — the streamed prose reports no usage. */
      inputTokens: number | null;
      outputTokens: number | null;
      elapsedMs: number | null;
    }
  | { kind: "error"; message: string };

export type Turn = { role: "user" | "assistant"; content: string };

/** Which model answered, what the planning call cost, how long it all took.
 *  Carried by every terminal event — an answer, a clarification and a refusal
 *  are all a model speaking, and "which one" is the same question each time. */
export type RunStats = {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  elapsedMs: number | null;
};

function runStats(data: Record<string, unknown>): RunStats {
  const usage = (data.usage ?? {}) as Record<string, unknown>;
  const count = (value: unknown) => (typeof value === "number" ? value : null);
  return {
    model: typeof data.model === "string" ? data.model : null,
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    elapsedMs: count(data.elapsed_ms),
  };
}

/** Cards arrive off the network, so they are narrowed rather than cast. A card
 *  that fails to parse is dropped: half a card is a button whose label does not
 *  describe what it will do. */
function proposedActions(value: unknown): ProposedAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): ProposedAction[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    const verb = item.verb === "update" ? "update" : item.verb === "create" ? "create" : null;
    if (verb === null || typeof item.name !== "string") return [];
    return [
      {
        index: typeof item.index === "number" ? item.index : 0,
        name: item.name,
        verb,
        resource: String(item.resource ?? ""),
        collection: String(item.collection ?? ""),
        target: typeof item.target === "string" ? item.target : null,
        before: asRecord(item.before),
        values: asRecord(item.values),
        status:
          item.status === "applied" ? "applied" : item.status === "failed" ? "failed" : "proposed",
        label: typeof item.label === "string" ? item.label : null,
        error: typeof item.error === "string" ? item.error : null,
      },
    ];
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** What became of one action. Deliberately not a `ProposedAction`: what comes
 *  back names the row that now exists, or the reason none does — it is an
 *  outcome, not a description of an intent. */
export type AppliedResult = {
  index: number;
  status: "applied" | "failed";
  id: string | null;
  label: string | null;
  error: string | null;
};

/** Apply the changes an organiser pressed. One result per index, in the order
 *  asked — a failure is per action, never for the batch. */
export async function applyProposal(
  eventId: string,
  proposalId: string,
  indexes: number[],
): Promise<AppliedResult[]> {
  const body = await authed<{ results: unknown }>(
    `/events/${eventId}/ai/proposals/${proposalId}/apply`,
    { method: "POST", body: { indexes } },
  );
  if (!Array.isArray(body.results)) return [];
  return body.results.flatMap((raw): AppliedResult[] => {
    const item = asRecord(raw);
    if (typeof item.index !== "number") return [];
    return [
      {
        index: item.index,
        status: item.status === "applied" ? "applied" : "failed",
        id: typeof item.id === "string" ? item.id : null,
        label: typeof item.label === "string" ? item.label : null,
        error: typeof item.error === "string" ? item.error : null,
      },
    ];
  });
}

/** Coerce an unknown field into a string list, dropping anything that is not a
 *  string. These arrive from the network, so a cast would be a lie the renderer
 *  pays for — `names.join()` on a number crashes the drawer. */
function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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
    case "model":
      return {
        kind: "model",
        name: String(data.name ?? ""),
        provider: String(data.provider ?? ""),
        isStub: Boolean(data.is_stub),
      };
    case "resolving":
      return { kind: "resolving", target: String(data.target ?? "") };
    case "proposal":
      return {
        kind: "proposal",
        proposalId: String(data.proposal_id ?? ""),
        actions: proposedActions(data.actions),
        isStub: Boolean(data.is_stub),
        run: runStats(data),
      };
    case "queries":
      return { kind: "queries", names: stringList(data.names) };
    case "token":
      return { kind: "token", text: String(data.text ?? "") };
    case "clarify":
      return {
        kind: "clarify",
        question: String(data.question ?? ""),
        isStub: Boolean(data.is_stub),
        run: runStats(data),
      };
    case "refusal":
      return {
        kind: "refusal",
        message: String(data.message ?? ""),
        isStub: Boolean(data.is_stub),
        run: runStats(data),
      };
    case "done":
      return {
        kind: "done",
        proposalId: String(data.proposal_id ?? ""),
        queries: stringList(data.queries),
        isStub: Boolean(data.is_stub),
        ...runStats(data),
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
