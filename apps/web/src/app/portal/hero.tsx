"use client";

/** The speaker's own face and details, at the top of their portal.
 *
 *  A headshot is the one thing a conference asks for that is *about* the person
 *  rather than about their talk, and the portal showed it nowhere — a set of
 *  initials in the corner, and later a 44px thumbnail in a checklist row. A
 *  speaker opening this could not tell which photograph the conference was
 *  about to print beside their name.
 *
 *  So it is shown at a size you can judge a photograph at, with the details the
 *  public page prints next to it, on the first screen they land on.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { portalBlobUrl } from "@/lib/session";

const PORTRAIT = 132;

export type HeroSpeaker = {
  name: string;
  pronouns: string | null;
  company: string | null;
  job_title: string | null;
  headshot_file_id: string | null;
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

/** The portrait, or a named placeholder that says what is missing.
 *
 *  Never a blank circle: an empty ring is indistinguishable from an image that
 *  failed to load, and the speaker cannot tell whether they still owe a photo.
 */
export function SpeakerPortrait({ speaker }: { speaker: HeroSpeaker }) {
  const fileId = speaker.headshot_file_id;
  const { data: url } = useQuery({
    queryKey: ["portal-file-preview", fileId],
    enabled: fileId !== null,
    // The bytes never change: a replacement is a new file id.
    staleTime: Infinity,
    retry: false,
    queryFn: () => portalBlobUrl(`/files/${fileId}`),
  });

  useEffect(() => {
    if (url === undefined) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  const frame: React.CSSProperties = {
    width: PORTRAIT,
    height: PORTRAIT,
    borderRadius: 20,
    flex: "none",
    overflow: "hidden",
    border: "1px solid var(--ln,#E1E7E9)",
    background: "var(--cd,#FFFFFF)",
    boxShadow: "0 1px 2px rgba(13,16,32,.05), 0 10px 28px rgba(13,16,32,.06)",
  };

  if (url === undefined) {
    return (
      <div
        style={{
          ...frame,
          display: "grid",
          placeItems: "center",
          background: "var(--sk,#EDF1F2)",
        }}
      >
        <span
          style={{
            font: "600 30px var(--font-plex-sans)",
            color: "var(--i4,#99A6AD)",
            letterSpacing: "0.04em",
          }}
        >
          {initialsOf(speaker.name)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={`${speaker.name}, as the programme will show them`}
      style={{ ...frame, objectFit: "cover", display: "block" }}
    />
  );
}

/** Name, role and pronouns — exactly the line the public speaker card prints. */
export function SpeakerIdentity({ speaker, onEdit }: { speaker: HeroSpeaker; onEdit: () => void }) {
  const role = [speaker.job_title, speaker.company].filter(Boolean).join(" · ");
  return (
    <div
      style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}
    >
      <div style={{ minWidth: 0 }}>
        {role === "" ? null : (
          <span
            style={{
              display: "block",
              font: "500 13.5px/1.5 var(--font-plex-sans)",
              color: "var(--i2,#3E4E58)",
            }}
          >
            {role}
          </span>
        )}
        {speaker.pronouns === null || speaker.pronouns.trim() === "" ? null : (
          <span
            style={{
              display: "block",
              font: "400 12px/1.5 var(--font-plex-mono)",
              color: "var(--i4,#99A6AD)",
            }}
          >
            {speaker.pronouns}
          </span>
        )}
      </div>
      <button
        onClick={onEdit}
        style={{
          height: 36,
          padding: "0 16px",
          borderRadius: 999,
          border: "1px solid var(--ls,#C8D2D5)",
          background: "var(--cd,#FFFFFF)",
          font: "500 12.5px var(--font-plex-sans)",
          color: "var(--ik,#16232B)",
          whiteSpace: "nowrap",
        }}
      >
        {speaker.headshot_file_id === null ? "Add your photo" : "Edit profile"}
      </button>
    </div>
  );
}
