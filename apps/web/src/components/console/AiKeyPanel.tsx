"use client";

/** The org key card (spec 0003): the organisation's own model API key.
 *
 *  Write-only by construction — the status endpoint returns configured-state,
 *  provider, model, the last four characters and provenance, never the key,
 *  and this panel has nowhere to put one if it arrived. The provider list
 *  comes from the same response, so this file never hardcodes who exists.
 *  Saving validates against the chosen provider first, so the failure lands
 *  here, inline, in front of the person who can fix it. Removing states its
 *  consequence before it happens.
 *
 *  Rendered only for owner/admin; the parent gates on role, and the API 403s
 *  anyone else regardless.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { components } from "@/lib/api-types";
import { authed } from "@/lib/session";

type KeyStatus = components["schemas"]["OrgKeyStatus"];

const CARD: React.CSSProperties = {
  border: "1px solid var(--ln,#E1E7E9)",
  borderRadius: 14,
  background: "var(--cd,#FFFFFF)",
  padding: "20px 22px",
  display: "grid",
  gap: 12,
};
const LABEL: React.CSSProperties = {
  font: "500 12px var(--font-plex-sans),sans-serif",
  color: "var(--i2,#3E4E58)",
};
const INPUT: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 40,
  padding: "0 12px",
  borderRadius: 6,
  border: "1px solid var(--ls,#C8D2D5)",
  background: "var(--cd,#FFFFFF)",
  font: "400 12.5px var(--font-plex-mono),monospace",
  color: "var(--ik,#16232B)",
};
const BUTTON: React.CSSProperties = {
  height: 38,
  padding: "0 16px",
  borderRadius: 8,
  border: "1px solid var(--ls,#C8D2D5)",
  background: "var(--cd,#FFFFFF)",
  font: "500 12.5px var(--font-plex-sans),sans-serif",
  color: "var(--ik,#16232B)",
  whiteSpace: "nowrap",
};

export function AiKeyPanel({ orgId, toast }: { orgId: string; toast: (m: string) => void }) {
  const queryClient = useQueryClient();
  const [keyDraft, setKeyDraft] = useState("");
  const [provider, setProvider] = useState("anthropic");
  /** Where the org's own model server is. Only the local provider has one, and
   *  only the operator knows it — every other base URL is hardcoded because a
   *  supplied one is an SSRF primitive. */
  const [baseUrl, setBaseUrl] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [capDraft, setCapDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const { data: status, isPending } = useQuery({
    queryKey: ["org-ai-key", orgId],
    queryFn: () => authed<KeyStatus>(`/orgs/${orgId}/ai-key`),
  });

  const chosen = status?.providers.find((option) => option.id === provider);
  const isLocal = chosen?.needs_key === false;

  /** What is actually installed on that server, so the model is a list of real
   *  things rather than a name you find out was wrong on your first question.
   *  A failed probe is not fatal: the field stays typeable with the reason
   *  beside it, because someone who knows their model's name should not be
   *  blocked by a server that answers slowly. */
  const local = useQuery({
    queryKey: ["local-models", orgId, baseUrl],
    enabled: isLocal && baseUrl.trim().length > 8,
    retry: false,
    queryFn: () =>
      authed<{ models: { name: string; size_bytes: number | null }[] }>(
        `/orgs/${orgId}/ai-key/local-models?base_url=${encodeURIComponent(baseUrl.trim())}`,
      ),
  });
  const providerLabel = (id: string | null) =>
    status?.providers.find((option) => option.id === id)?.label ?? id ?? "";

  const refresh = (updated: KeyStatus) => {
    queryClient.setQueryData(["org-ai-key", orgId], updated);
    setProblem("");
  };

  const save = useMutation({
    mutationFn: (body: {
      api_key?: string;
      provider?: string;
      model?: string;
      base_url?: string;
      daily_cap?: number;
    }) => authed<KeyStatus>(`/orgs/${orgId}/ai-key`, { method: "PUT", body }),
    onSuccess: (updated, sent) => {
      refresh(updated);
      if (sent.api_key !== undefined) {
        setKeyDraft(""); // the field never keeps a working secret on screen
        toast(
          `Key ending ${updated.last4} saved — AI suggestions now run on ${providerLabel(updated.provider)}.`,
        );
      } else {
        toast("Daily cap saved.");
      }
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const remove = useMutation({
    mutationFn: () => authed<KeyStatus>(`/orgs/${orgId}/ai-key`, { method: "DELETE" }),
    onSuccess: (updated) => {
      refresh(updated);
      setConfirmingRemove(false);
      toast("Key removed — AI suggestions return to samples.");
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const saveKey = () => {
    if (isLocal) {
      // No key exists to send. The model is required rather than optional: a
      // local server carries several and there is no sensible default.
      save.mutate({ provider, model: modelDraft.trim(), base_url: baseUrl.trim() });
      return;
    }
    const body: { api_key: string; provider: string; model?: string } = {
      api_key: keyDraft.trim(),
      provider,
    };
    if (modelDraft.trim() !== "") body.model = modelDraft.trim();
    save.mutate(body);
  };

  const canSave = isLocal
    ? baseUrl.trim() !== "" && modelDraft.trim() !== ""
    : keyDraft.trim().length >= 8;

  const capValue = capDraft ?? (status?.daily_cap === null ? "" : String(status?.daily_cap ?? ""));
  const commitCap = () => {
    if (capDraft === null || capDraft.trim() === "") return;
    const parsed = Number(capDraft);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setProblem("The daily cap must be a whole number, 0 or more. 0 turns AI off.");
      return;
    }
    save.mutate({ daily_cap: parsed });
  };

  if (isPending) {
    // An honest gap, not the "no key" copy pretending to be truth.
    return (
      <div style={CARD} aria-busy="true">
        <span style={{ font: "600 14px var(--font-plex-sans),sans-serif" }}>
          AI suggestions — your model API key
        </span>
        <span
          style={{
            font: "400 12.5px var(--font-plex-sans),sans-serif",
            color: "var(--i4,#99A6AD)",
          }}
        >
          Loading the current configuration…
        </span>
      </div>
    );
  }

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ font: "600 14px var(--font-plex-sans),sans-serif", flex: 1 }}>
          AI suggestions — your model API key
        </span>
        {status?.configured === true ? (
          <span
            style={{
              font: "500 11.5px var(--font-plex-mono),monospace",
              color: "var(--i3,#6B7B84)",
              border: "1px solid var(--ls,#C8D2D5)",
              borderRadius: 99,
              padding: "3px 10px",
            }}
          >
            {providerLabel(status.provider)}
            {status.model !== null ? ` · ${status.model}` : ""} · …{status.last4}
          </span>
        ) : null}
      </div>

      <p
        style={{
          font: "400 12.5px/1.6 var(--font-plex-sans),sans-serif",
          color: "var(--i2,#3E4E58)",
          margin: 0,
        }}
      >
        {status?.configured === true
          ? `Set by ${status.set_by_name ?? "someone"} · every AI suggestion in this organisation runs on this key. It is stored sealed and can never be read back — replace or remove it below.`
          : "Without a key, suggestions are labelled samples. Pick your provider — Anthropic, OpenAI, Meta, Google, xAI, DeepSeek, Kimi, or a Llama host — paste its API key, and it is checked with the provider before being saved; it is stored sealed and can never be read back."}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10 }}>
        <div>
          <label htmlFor="org-ai-provider" style={LABEL}>
            Provider
          </label>
          <select
            id="org-ai-provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            style={{ ...INPUT, marginTop: 5, font: "400 13px var(--font-plex-sans),sans-serif" }}
          >
            {(status?.providers ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="org-ai-model" style={LABEL}>
            Model{provider === "anthropic" ? " (optional)" : ""}
          </label>
          {isLocal && (local.data?.models.length ?? 0) > 0 ? (
            <select
              id="org-ai-model"
              value={modelDraft}
              onChange={(event) => setModelDraft(event.target.value)}
              style={{ ...INPUT, marginTop: 5, font: "400 13px var(--font-plex-sans),sans-serif" }}
            >
              <option value="">Choose a model…</option>
              {(local.data?.models ?? []).map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="org-ai-model"
              placeholder={chosen?.model_hint ?? ""}
              value={modelDraft}
              onChange={(event) => setModelDraft(event.target.value)}
              style={{ ...INPUT, marginTop: 5 }}
            />
          )}
        </div>
      </div>

      {isLocal ? (
        <div>
          <label htmlFor="org-ai-base-url" style={LABEL}>
            Server address
          </label>
          <input
            id="org-ai-base-url"
            placeholder="http://localhost:11434"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            style={{ ...INPUT, marginTop: 5 }}
          />
          <p
            style={{
              margin: "6px 0 0",
              font: "400 11.5px/1.5 var(--font-plex-sans),sans-serif",
              color: "var(--i4,#99A6AD)",
            }}
          >
            {local.isFetching
              ? "Looking for models on that server…"
              : local.isError
                ? (local.error as Error).message
                : (local.data?.models.length ?? 0) > 0
                  ? `${local.data?.models.length} model(s) found — pick one above.`
                  : "Must be a loopback or private address: this server will not fetch a public one. On a hosted install “localhost” means the server’s own machine, not yours."}
          </p>
        </div>
      ) : null}

      {(modelDraft.trim() || chosen?.model_hint || "").endsWith("-contributor") ? (
        <p
          style={{
            margin: 0,
            padding: "10px 13px",
            borderRadius: 8,
            border: "1px solid var(--ifl,#C6CDEA)",
            background: "var(--ifw,#E9ECF7)",
            font: "400 12px/1.5 var(--font-plex-sans),sans-serif",
            color: "var(--i2,#3E4E58)",
          }}
        >
          Contributor tiers cost less because the provider may use prompts for training. Submission
          abstracts and answers are part of those prompts — fine for demo data, a real decision for
          real speakers&rsquo; proposals.
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
        {isLocal ? (
          <p
            style={{
              margin: 0,
              font: "400 12.5px/1.5 var(--font-plex-sans),sans-serif",
              color: "var(--i2,#3E4E58)",
            }}
          >
            A local server has no API key. Its address is checked before saving, so a wrong port
            fails here rather than on your first question.
          </p>
        ) : (
          <div>
            <label htmlFor="org-ai-key" style={LABEL}>
              {status?.configured === true ? "Replace the key" : "API key"}
            </label>
            <input
              id="org-ai-key"
              type="password"
              autoComplete="off"
              placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              style={{ ...INPUT, marginTop: 5 }}
            />
          </div>
        )}
        <button
          type="button"
          disabled={!canSave || save.isPending}
          onClick={saveKey}
          style={{
            ...BUTTON,
            background: "var(--bt,#141417)",
            color: "var(--bf,#FFFFFF)",
            border: "none",
            opacity: !canSave || save.isPending ? 0.55 : 1,
          }}
        >
          {save.isPending ? "Checking…" : isLocal ? "Check and use" : "Check and save"}
        </button>
      </div>

      {problem !== "" ? (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: "10px 13px",
            borderRadius: 8,
            border: "1px solid var(--cnl,#F3C7C2)",
            background: "var(--cnw,#FBE8E6)",
            font: "400 12.5px/1.5 var(--font-plex-sans),sans-serif",
            color: "var(--cn,#D8432B)",
          }}
        >
          {problem}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
        <div>
          <label htmlFor="org-ai-cap" style={LABEL}>
            Daily suggestion cap — whole organisation, all events together
          </label>
          <input
            id="org-ai-cap"
            inputMode="numeric"
            placeholder={`${status?.cap_default ?? 200} (the default)`}
            value={capValue}
            onChange={(event) => setCapDraft(event.target.value)}
            onBlur={commitCap}
            style={{ ...INPUT, marginTop: 5, fontVariantNumeric: "tabular-nums" }}
          />
        </div>
        {status?.configured === true ? (
          confirmingRemove ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => remove.mutate()}
                style={{
                  ...BUTTON,
                  height: 44,
                  color: "var(--cn,#D8432B)",
                  borderColor: "var(--cnl,#F3C7C2)",
                }}
              >
                {remove.isPending ? "Removing…" : "Remove — back to samples"}
              </button>
              <button type="button" onClick={() => setConfirmingRemove(false)} style={BUTTON}>
                Keep it
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmingRemove(true)} style={BUTTON}>
              Remove key…
            </button>
          )
        ) : null}
      </div>

      <p
        style={{
          font: "400 11.5px/1.5 var(--font-plex-sans),sans-serif",
          color: "var(--i4,#99A6AD)",
          margin: 0,
        }}
      >
        The cap protects your bill: once the organisation has made that many suggestions in a day,
        the next one is refused until midnight UTC. 0 turns AI off entirely; blank uses the default.
      </p>
    </div>
  );
}
