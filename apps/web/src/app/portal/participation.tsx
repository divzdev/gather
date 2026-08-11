"use client";

/** "Yes, I'll be there" — the answer only the speaker can give.
 *
 *  `EventSpeaker` has carried `confirmed` and `declined` since the first
 *  migration and nothing in the portal ever set them, so a roster full of
 *  confirmed speakers recorded an organiser's assumption. This band is the one
 *  place a speaker can say it themselves.
 *
 *  It sits above the portal rather than inside it because the answer outranks
 *  everything else on the screen until it is given: there is no point chasing
 *  someone for a headshot before they have said they are coming.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { portal } from "@/lib/session";

type Status = "prospective" | "accepted" | "confirmed" | "declined" | "withdrawn";

export type Participation = {
  status: Status;
  responded_at: string | null;
  decline_reason: string | null;
  can_respond: boolean;
};

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });

const band = (accent: string, wash: string): React.CSSProperties => ({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 12,
  padding: "14px 20px",
  borderBottom: `1px solid ${accent}`,
  background: wash,
  font: "400 13.5px/1.5 'IBM Plex Sans',sans-serif",
});

const primary: React.CSSProperties = {
  height: 36,
  padding: "0 18px",
  borderRadius: 999,
  border: "none",
  background: "#FF6B6B",
  color: "#331313",
  font: "600 13px 'IBM Plex Sans',sans-serif",
  cursor: "pointer",
};

const quiet: React.CSSProperties = {
  height: 36,
  padding: "0 14px",
  borderRadius: 999,
  border: "1px solid var(--ls,#C8D2D5)",
  background: "transparent",
  color: "var(--i2,#3E4E58)",
  font: "500 13px 'IBM Plex Sans',sans-serif",
  cursor: "pointer",
};

export function ParticipationBand({ state }: { state: Participation | undefined }) {
  const queryClient = useQueryClient();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const answer = useMutation({
    mutationFn: (body: { status: "confirmed" | "declined"; reason?: string }) =>
      portal<Participation>("/participation", { method: "PUT", body }),
    onSuccess: () => {
      setDeclining(false);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["portal-home"] });
    },
  });

  if (state === undefined || !state.can_respond) return null;

  if (state.status === "declined") {
    return (
      <div style={band("var(--ln,#E1E7E9)", "var(--sk,#EDF1F2)")}>
        <span style={{ flex: 1, minWidth: 240, color: "var(--i2,#3E4E58)" }}>
          You told us you cannot make it
          {state.responded_at === null ? "" : ` on ${WHEN.format(new Date(state.responded_at))}`}.
          The organisers have been shown this.
        </span>
        <button style={quiet} onClick={() => answer.mutate({ status: "confirmed" })}>
          Actually, I can make it
        </button>
      </div>
    );
  }

  if (state.status === "confirmed") {
    return (
      <div style={band("var(--okl,#C2E0D5)", "var(--okw,#E2F1EC)")}>
        <span style={{ flex: 1, minWidth: 240, color: "var(--ok,#0E7A5F)" }}>
          You are confirmed
          {state.responded_at === null
            ? ""
            : ` — you told us on ${WHEN.format(new Date(state.responded_at))}`}
          .
        </span>
        <button style={quiet} onClick={() => setDeclining(true)}>
          Something has changed
        </button>
        {declining ? <DeclineForm reason={reason} setReason={setReason} answer={answer} /> : null}
      </div>
    );
  }

  // Accepted, and they have not answered yet. The loud one.
  return (
    <div style={band("var(--sl,#FFC9C0)", "var(--sw,#FFEAE6)")}>
      <span style={{ flex: 1, minWidth: 260, color: "var(--ik,#16232B)" }}>
        <strong style={{ font: "600 14px 'IBM Plex Sans',sans-serif" }}>
          You are accepted. Can you be there?
        </strong>
        <br />
        Nothing else here matters until the organisers know, and they will not chase you for
        anything until you say yes.
      </span>
      {declining ? (
        <DeclineForm reason={reason} setReason={setReason} answer={answer} />
      ) : (
        <>
          <button
            style={primary}
            disabled={answer.isPending}
            onClick={() => answer.mutate({ status: "confirmed" })}
          >
            {answer.isPending ? "Saving…" : "Yes, I'll be there"}
          </button>
          <button style={quiet} onClick={() => setDeclining(true)}>
            I can&apos;t make it
          </button>
        </>
      )}
    </div>
  );
}

function DeclineForm({
  reason,
  setReason,
  answer,
}: {
  reason: string;
  setReason: (value: string) => void;
  answer: { mutate: (body: { status: "declined"; reason?: string }) => void; isPending: boolean };
}) {
  return (
    <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why, if you'd like to say"
        aria-label="Why you cannot make it"
        style={{
          height: 36,
          minWidth: 220,
          padding: "0 12px",
          borderRadius: 8,
          border: "1px solid var(--ls,#C8D2D5)",
          background: "var(--cd,#FFFFFF)",
          font: "400 13px 'IBM Plex Sans',sans-serif",
          color: "var(--ik,#16232B)",
        }}
      />
      <button
        style={primary}
        disabled={answer.isPending}
        onClick={() =>
          answer.mutate({
            status: "declined",
            ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
          })
        }
      >
        {answer.isPending ? "Saving…" : "Send it"}
      </button>
    </span>
  );
}
