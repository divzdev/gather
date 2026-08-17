"use client";

/** The two things an organiser could not do to a speaker from the console.
 *
 *  Portal access used to be something that happened *to* a speaker — a link fell
 *  out of an acceptance email, or they asked for one themselves — so "have you
 *  got in yet?" had no answer and no fix. And the only route that set a photo
 *  was the speaker's own, which left a headshot emailed to the organiser
 *  unusable.
 */

import type { RefObject } from "react";

const CONTROL = {
  display: "inline-flex",
  alignItems: "center",
  height: 36,
  padding: "0 14px",
  borderRadius: 8,
  border: "1px solid var(--ls,#C8D2D5)",
  background: "none",
  font: "500 12.5px var(--font-plex-sans), sans-serif",
  color: "var(--ik,#16232B)",
  whiteSpace: "nowrap",
  cursor: "pointer",
} as const;

export function SpeakerActions({
  eventSpeakerId,
  name,
  busy,
  onInvite,
  onPhoto,
  inputRef,
}: {
  eventSpeakerId: string;
  name: string;
  busy: boolean;
  onInvite: () => void;
  onPhoto: (file: File) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 8, flex: "none" }}>
      <button
        type="button"
        onClick={onInvite}
        disabled={busy}
        style={{ ...CONTROL, opacity: busy ? 0.6 : 1 }}
      >
        {busy ? "Sending…" : "Send portal invite"}
      </button>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        style={{ ...CONTROL, opacity: busy ? 0.6 : 1 }}
      >
        Upload photo
      </button>
      <input
        // Keyed on the speaker so switching drawers cannot leave the previous
        // person's chosen file sitting in the control.
        key={eventSpeakerId}
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={`Upload a headshot for ${name}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) onPhoto(file);
          // Cleared so choosing the same file twice still fires a change.
          event.target.value = "";
        }}
        style={{ display: "none" }}
      />
    </span>
  );
}
