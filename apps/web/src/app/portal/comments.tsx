"use client";

/** The speaker's feedback tab.
 *
 *  A top-level tab rather than something folded inside each task: a speaker
 *  opens this on a phone two or three times in a month, and an organiser's
 *  request that only appears once you tap the right deliverable is a request
 *  nobody answers.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { FileThreads, type FileThread } from "@/components/FileThreads";
import { portal } from "@/lib/session";

/** Shares a query key with `PortalComments`, so the badge and the tab body are
 *  one request rather than two. */
export function useFeedbackCount(enabled: boolean): number {
  const { data } = useQuery({
    queryKey: ["portal-file-comments"],
    enabled,
    queryFn: () => portal<FileThread[]>("/file-comments"),
  });
  return (data ?? []).reduce((total, thread) => total + thread.comments.length, 0);
}

export function PortalComments() {
  const client = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["portal-file-comments"],
    queryFn: () => portal<FileThread[]>("/file-comments"),
  });

  // `portal` serialises the body itself; stringifying here as well posted a
  // JSON *string* and earned a silent 422.
  const send = useMutation({
    mutationFn: ({ fileId, body }: { fileId: string; body: string }) =>
      portal(`/files/${fileId}/comments`, { method: "POST", body: { body } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["portal-file-comments"] }),
  });

  return (
    <div
      data-portal-feedback
      style={{ padding: "0 16px 96px", maxWidth: "720px", margin: "0 auto" }}
    >
      {/* The Portal prototype carries an inline `min-height:100vh`, so a tab
       *  rendered as its sibling starts a full screen below the fold — the
       *  speaker taps Feedback and sees nothing. Inline styles beat a
       *  stylesheet, hence `!important`; scoped to this tab so the prototype is
       *  untouched everywhere else. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            'body:has([data-portal-feedback]) [data-screen-label="Speaker portal"]{min-height:0!important}',
        }}
      />
      <h2
        style={{
          font: "600 20px 'IBM Plex Sans',sans-serif",
          color: "var(--ik,#16232B)",
          margin: "20px 0 4px",
        }}
      >
        Feedback
      </h2>
      <p
        style={{
          font: "400 13px 'IBM Plex Sans',sans-serif",
          color: "var(--i3,#6B7B84)",
          margin: "0 0 16px",
        }}
      >
        Comments on the files you have uploaded. Your organiser sees your replies here too.
      </p>
      {isPending ? (
        <p style={{ font: "400 13px 'IBM Plex Sans',sans-serif", color: "var(--i4,#99A6AD)" }}>
          Loading…
        </p>
      ) : (
        <FileThreads
          threads={data ?? []}
          viewer="speaker"
          sending={send.isPending}
          onSend={(fileId, body) => send.mutateAsync({ fileId, body })}
        />
      )}
    </div>
  );
}
