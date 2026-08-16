"use client";

/** What a speaker actually uploaded, shown as itself.
 *
 *  A headshot is a photograph, and the task row described it as
 *  `Screenshot-2026-08-13-at-8.47.08-AM.png · version 9` — a filename, which is
 *  the one thing that cannot tell you whether the photo is the right photo, or
 *  even whether it is a photo. Version 9 is what that looks like from the
 *  speaker's side: re-uploading blind, because nothing on screen ever showed
 *  them what the organiser had.
 *
 *  There was no infrastructure to build. `portalBlobUrl` already fetches an
 *  owned file with the speaker's bearer token and hands back an object URL —
 *  the Profile tab has rendered the headshot that way all along. This is the
 *  same call, in the place the file is actually discussed.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { portalBlobUrl } from "@/lib/session";

export type ThumbFile = {
  id: string;
  filename: string;
  content_type: string;
  version: number;
};

/** Only what a browser will actually paint. A PDF deck stays a filename — a
 *  broken image icon would be worse than the text it replaced. */
function isImage(file: ThumbFile): boolean {
  return /^image\/(png|jpeg|jpg|gif|webp|avif)$/.test(file.content_type.toLowerCase());
}

const FRAME = 44;

const box: React.CSSProperties = {
  width: FRAME,
  height: FRAME,
  borderRadius: 10,
  flex: "none",
  border: "1px solid var(--ln,#E1E7E9)",
  background: "var(--sk,#EDF1F2)",
  overflow: "hidden",
};

/** A file on a task row: the picture if it is one, then its name and version. */
export function TaskFilePreview({ file }: { file: ThumbFile }) {
  const label = `${file.filename} · version ${file.version}`;
  if (!isImage(file)) return <>{label}</>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <Thumb file={file} />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </span>
  );
}

function Thumb({ file }: { file: ThumbFile }) {
  const { data: url, isPending } = useQuery({
    queryKey: ["portal-file-preview", file.id],
    // The bytes never change: a replacement is a new file id, not new content
    // under the old one.
    staleTime: Infinity,
    retry: false,
    queryFn: () => portalBlobUrl(`/files/${file.id}`),
  });

  // Object URLs are held by the document until revoked. Without this, a speaker
  // who replaces a headshot four times leaks four images for the session.
  useEffect(() => {
    if (url === undefined) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  if (isPending || url === undefined) {
    // A sized placeholder rather than nothing, so the row does not jump when
    // the image lands.
    return <span aria-hidden style={box} />;
  }

  return (
    <img
      src={url}
      // The filename is already beside it; announcing it twice is noise to a
      // screen reader, so this describes what the image *is*.
      alt="The photo you uploaded"
      style={{ ...box, objectFit: "cover", display: "block" }}
    />
  );
}
