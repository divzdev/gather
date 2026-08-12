"use client";

/** A speaker's durable link: /p/<token> signs them into one event's portal.
 *
 *  The whole page is a hallway. It exists because the token has to travel in a
 *  URL, and a URL should never be spent by a Server Component render — the
 *  exchange happens here, once, in the browser, and the address bar is replaced
 *  so the token does not linger in plain sight.
 */

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { setSpeakerToken } from "@/lib/session";

export default function PortalLinkPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const issued = await apiFetch<{ access_token: string }>("/auth/portal-link/consume", {
          method: "POST",
          body: { token: params.token },
        });
        setSpeakerToken(issued.access_token);
        router.replace("/portal");
      } catch {
        setFailed(true);
      }
    })();
  }, [params.token, router]);

  return (
    <main
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100vh",
        background: "var(--pp,#F4F6F7)",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: "420px",
          textAlign: "center",
          font: "400 14px/1.6 'IBM Plex Sans',sans-serif",
          color: "var(--i2,#3E4E58)",
        }}
      >
        {failed ? (
          <>
            <div
              style={{
                font: "600 17px 'IBM Plex Sans',sans-serif",
                color: "var(--ik,#16232B)",
                marginBottom: "8px",
              }}
            >
              This link is no longer valid
            </div>
            A newer link replaced it, or it was never one of ours. Ask for a fresh sign-in link and
            a new copy of this one will be waiting in your portal.
            <div style={{ marginTop: "16px" }}>
              <a href="/portal" style={{ color: "var(--sg,#E04E4E)" }}>
                Request a sign-in link
              </a>
            </div>
          </>
        ) : (
          "Opening your portal…"
        )}
      </div>
    </main>
  );
}
