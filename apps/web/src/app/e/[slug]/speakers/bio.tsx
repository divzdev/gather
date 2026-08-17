"use client";

/** A speaker's bio, clamped with a way to read the rest.
 *
 *  A conference bio runs anywhere from one line to six paragraphs, and the
 *  panel it sits in also has to show the sessions underneath. Printing the long
 *  ones in full pushes the talks off the bottom, which is the thing a reader
 *  opened the card for.
 *
 *  The control only appears when there is something hidden — a "Show more" on a
 *  two-line bio is a button that does nothing, which is worse than no button.
 */

import { useState } from "react";

/** Long enough that clamping earns its keep, short enough that most bios are
 *  simply shown whole. */
const LIMIT = 260;

export function Bio({ text, color, font }: { text: string; color: string; font: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > LIMIT;

  return (
    <p
      style={{
        fontFamily: font,
        fontSize: 14.5,
        fontWeight: 500,
        color,
        lineHeight: 1.6,
        margin: "0 0 20px",
        whiteSpace: "pre-wrap",
      }}
    >
      {!long || open ? text : `${text.slice(0, LIMIT).trimEnd()}…`}
      {long ? (
        <>
          {" "}
          <button
            type="button"
            onClick={() => setOpen((shown) => !shown)}
            style={{
              display: "inline",
              padding: 0,
              border: "none",
              background: "none",
              font: "inherit",
              fontWeight: 700,
              color: "inherit",
              textDecoration: "underline",
              textUnderlineOffset: 3,
              cursor: "pointer",
            }}
          >
            {open ? "Show less" : "Show more"}
          </button>
        </>
      ) : null}
    </p>
  );
}
