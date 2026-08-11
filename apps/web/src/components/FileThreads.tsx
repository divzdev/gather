"use client";

/** The conversation about a deliverable, as both sides see it.
 *
 *  One component for the organiser and the speaker because it is one thread —
 *  if the two rendered differently, the thing being demonstrated (that they are
 *  reading the same messages) would be the thing you could not see.
 */

import { useState } from "react";

export type FileComment = {
  id: string;
  body: string;
  author_kind: "staff" | "speaker";
  author_name: string;
  file_version: number;
  created_at: string;
};

export type FileThread = {
  file_id: string;
  filename: string;
  version: number;
  task_name: string;
  speaker_name: string;
  comments: FileComment[];
};

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function FileThreads({
  threads,
  viewer,
  onSend,
  sending,
}: {
  threads: readonly FileThread[];
  viewer: "staff" | "speaker";
  onSend: (fileId: string, body: string) => Promise<unknown>;
  sending: boolean;
}) {
  if (threads.length === 0) {
    return (
      <p
        style={{
          font: "400 13px 'IBM Plex Sans',sans-serif",
          color: "var(--i3,#6B7B84)",
          margin: "0",
        }}
      >
        {viewer === "staff"
          ? "Nothing has been uploaded yet, so there is nothing to comment on."
          : "No feedback yet. Anything your organiser writes about a file you have uploaded will appear here."}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {threads.map((thread) => (
        <Thread
          key={thread.file_id}
          thread={thread}
          viewer={viewer}
          onSend={onSend}
          sending={sending}
        />
      ))}
    </div>
  );
}

function Thread({
  thread,
  viewer,
  onSend,
  sending,
}: {
  thread: FileThread;
  viewer: "staff" | "speaker";
  onSend: (fileId: string, body: string) => Promise<unknown>;
  sending: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState(false);

  // The draft survives a failure. Clearing it on send and *then* discovering
  // the request 422'd loses what the person wrote and tells them nothing —
  // which is indistinguishable from having posted successfully.
  const send = async () => {
    const body = draft.trim();
    if (body === "" || sending) return;
    try {
      await onSend(thread.file_id, body);
      setDraft("");
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <section
      style={{
        border: "1px solid var(--ln,#E1E7E9)",
        borderRadius: "12px",
        background: "var(--cd,#FFFFFF)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "8px",
          flexWrap: "wrap",
          padding: "10px 14px",
          borderBottom: "1px solid var(--ln,#E1E7E9)",
          background: "var(--sk,#EDF1F2)",
        }}
      >
        <span
          style={{
            font: "600 13px 'IBM Plex Sans',sans-serif",
            color: "var(--ik,#16232B)",
          }}
        >
          {thread.task_name}
        </span>
        {viewer === "staff" ? (
          <span
            style={{
              font: "400 12px 'IBM Plex Sans',sans-serif",
              color: "var(--i3,#6B7B84)",
            }}
          >
            {thread.speaker_name}
          </span>
        ) : null}
        <span style={{ flex: "1" }} />
        <span
          style={{
            font: "400 11px 'IBM Plex Mono',monospace",
            color: "var(--i4,#99A6AD)",
          }}
        >
          {thread.filename} · v{thread.version}
        </span>
      </header>

      <ol style={{ listStyle: "none", margin: "0", padding: "0" }}>
        {thread.comments.map((comment) => (
          <li
            key={comment.id}
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--ln,#E1E7E9)",
              // The side a message came from is what makes a two-party thread
              // readable at a glance; a flat list of names is not.
              background:
                comment.author_kind === viewer ? "var(--cd,#FFFFFF)" : "var(--pp,#F4F6F7)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
                flexWrap: "wrap",
                marginBottom: "3px",
              }}
            >
              <span
                style={{
                  font: "600 12px 'IBM Plex Sans',sans-serif",
                  color: "var(--ik,#16232B)",
                }}
              >
                {comment.author_name}
              </span>
              <span
                style={{
                  font: "500 10px 'IBM Plex Mono',monospace",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  padding: "1px 6px",
                  borderRadius: "4px",
                  background:
                    comment.author_kind === "staff" ? "var(--ifw,#E9ECF7)" : "var(--okw,#E2F1EC)",
                  color:
                    comment.author_kind === "staff" ? "var(--if,#47599F)" : "var(--ok,#0E7A5F)",
                }}
              >
                {comment.author_kind === "staff" ? "Organiser" : "Speaker"}
              </span>
              <span
                style={{
                  font: "400 11px 'IBM Plex Mono',monospace",
                  color: "var(--i4,#99A6AD)",
                }}
              >
                {WHEN.format(new Date(comment.created_at))}
                {comment.file_version !== thread.version ? ` · on v${comment.file_version}` : ""}
              </span>
            </div>
            <p
              style={{
                font: "400 13px/1.5 'IBM Plex Sans',sans-serif",
                color: "var(--i2,#3E4E58)",
                margin: "0",
                whiteSpace: "pre-wrap",
              }}
            >
              {comment.body}
            </p>
          </li>
        ))}
      </ol>

      {failed ? (
        <p
          role="alert"
          style={{
            font: "500 12px 'IBM Plex Sans',sans-serif",
            color: "var(--cn,#D8432B)",
            background: "var(--cnw,#FBE8E6)",
            margin: "0",
            padding: "8px 14px",
          }}
        >
          That didn&rsquo;t send. Your message is still here — try again.
        </p>
      ) : null}

      <div style={{ display: "flex", gap: "8px", padding: "10px 14px", alignItems: "flex-end" }}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          aria-label={`Comment on ${thread.filename}`}
          placeholder={
            viewer === "staff"
              ? "Ask for a change. The speaker sees this."
              : "Reply to your organiser…"
          }
          style={{
            flex: "1",
            minWidth: "0",
            resize: "vertical",
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid var(--ls,#C8D2D5)",
            background: "var(--cd,#FFFFFF)",
            color: "var(--ik,#16232B)",
            font: "400 13px 'IBM Plex Sans',sans-serif",
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={draft.trim() === "" || sending}
          style={{
            height: "32px",
            padding: "0 14px",
            borderRadius: "999px",
            border: "none",
            background: draft.trim() === "" ? "var(--sk,#EDF1F2)" : "var(--bt,#FF6B6B)",
            color: draft.trim() === "" ? "var(--i4,#99A6AD)" : "var(--bf,#331313)",
            font: "600 12px 'IBM Plex Sans',sans-serif",
            whiteSpace: "nowrap",
          }}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </section>
  );
}
