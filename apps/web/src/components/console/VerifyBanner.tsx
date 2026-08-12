"use client";

/** Said once, at the top of every console screen, until the address is confirmed.
 *
 *  It exists because the refusal it warns about arrives at the worst possible
 *  moment otherwise: an organiser sets an event up, decides two hundred
 *  submissions, opens the send dialog and *then* meets a 403. The rule is worth
 *  keeping — an unconfirmed account must not be able to mail two hundred people
 *  — but finding out about it there is a design failure, not a security win.
 *
 *  Not a modal and not a blocker. Everything except sending and publishing works
 *  perfectly well without confirming, so this stays out of the way and names
 *  exactly the two things that do not.
 */

import { useMutation } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export function VerifyBanner({ email }: { email: string }) {
  const resend = useMutation({
    mutationFn: () => apiFetch("/auth/magic-link", { method: "POST", body: { email } }),
  });

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        padding: "12px 28px",
        background: "var(--pdw,#F9EDDF)",
        borderBottom: "1px solid var(--pdl,#EFD3B6)",
        font: "400 13px var(--font-plex-sans), sans-serif",
        color: "var(--ik,#16232B)",
        lineHeight: 1.5,
      }}
    >
      <span style={{ minWidth: 0 }}>
        <b style={{ fontWeight: 600 }}>Confirm your email to send and publish.</b> Everything else
        works now. We sent a link to {email}; opening it signs you in and confirms the address.
      </span>
      <button
        type="button"
        onClick={() => resend.mutate()}
        disabled={resend.isPending || resend.isSuccess}
        style={{
          marginLeft: "auto",
          minHeight: 36,
          padding: "0 18px",
          borderRadius: 999,
          border: "1px solid var(--pdl,#EFD3B6)",
          background: "var(--cd,#FFFFFF)",
          font: "500 12.5px var(--font-plex-sans), sans-serif",
          color: "var(--pd,#B96A1F)",
          whiteSpace: "nowrap",
          cursor: resend.isSuccess ? "default" : "pointer",
        }}
      >
        {resend.isSuccess ? "Link sent" : resend.isPending ? "Sending…" : "Send it again"}
      </button>
      {resend.isError ? (
        <span style={{ color: "var(--cn,#D8432B)", width: "100%" }}>
          That did not send. Wait a minute and try again — there is a limit of three an hour.
        </span>
      ) : null}
    </div>
  );
}
