/** Rules for the auto-scheduler, read from what an organiser types.
 *
 *  This is pattern matching, not a language model. There *is* a model in this
 *  product now — it suggests review scores, behind `features/ai` — and this is
 *  deliberately not it: a packer that silently guessed at a rule it had not
 *  understood would be worse than one that says so. It recognises four
 *  phrasings, shows each one it understood as a chip you can remove, and says
 *  plainly which lines it could not read rather than dropping them. The panel's
 *  copy has to keep saying that too.
 *
 *  The alternative was deleting the box, which is what it deserved while it
 *  discarded every keystroke. Four real rules beat an empty affordance, and
 *  beat a fifth rule guessed at badly.
 */

export type Constraint =
  | { kind: "free"; label: string; from: number; to: number }
  | { kind: "notBefore"; label: string; minute: number }
  | { kind: "notAfter"; label: string; minute: number }
  | { kind: "avoidRoom"; label: string; roomIndex: number };

export type Parsed = {
  understood: Constraint[];
  /** Lines that matched nothing, kept verbatim so the panel can quote them. */
  ignored: string[];
};

/** "14:30" or "2:30pm" or "2pm" → minutes from midnight, or null. */
function clockToMinutes(raw: string): number | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(raw.trim());
  if (match === null) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const suffix = match[3]?.toLowerCase();
  if (hour > 23 || minute > 59) return null;
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

const CLOCK = "(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)";

const FREE = new RegExp(
  `(?:leave|keep|block)\\s+${CLOCK}\\s*(?:to|-|–|until)?\\s*${CLOCK}?\\s*(?:free|clear|empty|open)`,
  "i",
);
const NOT_BEFORE = new RegExp(
  `(?:nothing|no sessions?|don't start|do not start|not)\\s+(?:before|earlier than)\\s+${CLOCK}`,
  "i",
);
const NOT_AFTER = new RegExp(
  `(?:nothing|no sessions?|finish|end|done)\\s+(?:after|by|later than)\\s+${CLOCK}`,
  "i",
);

/** Split on newlines and sentence punctuation: people write one rule per line
 *  and also "Leave 12:00 free, and nothing after 17:00" on one. */
function clauses(text: string): string[] {
  return text
    .split(/[\n.;]+|,\s*(?=and\b|then\b|also\b)/i)
    .map((part) => part.replace(/^\s*(?:and|also|then)\s+/i, "").trim())
    .filter((part) => part !== "");
}

/**
 * @param text     What the organiser typed.
 * @param rooms    The event's real rooms, in grid order — a room rule can only
 *                 name a room that exists, so a typo is reported, not obeyed.
 * @param dayStart Minutes-from-midnight of the grid's first row, so every
 *                 returned minute is an offset into the grid rather than a
 *                 wall-clock time the packer would have to convert again.
 */
export function parseConstraints(
  text: string,
  rooms: { name: string }[],
  dayStart: number,
): Parsed {
  const understood: Constraint[] = [];
  const ignored: string[] = [];

  for (const clause of clauses(text)) {
    const free = FREE.exec(clause);
    if (free !== null) {
      const from = clockToMinutes(free[1] ?? "");
      const to = free[2] === undefined ? null : clockToMinutes(free[2]);
      if (from !== null) {
        // "Leave 12:00 free" with no end means the hour, which is what someone
        // blocking out lunch means and never has to say.
        const start = from - dayStart;
        const end = (to ?? from + 60) - dayStart;
        understood.push({
          kind: "free",
          label: `${hhmm(from)}–${hhmm(to ?? from + 60)} stays free`,
          from: start,
          to: end,
        });
        continue;
      }
    }

    const before = NOT_BEFORE.exec(clause);
    if (before !== null) {
      const at = clockToMinutes(before[1] ?? "");
      if (at !== null) {
        understood.push({
          kind: "notBefore",
          label: `nothing before ${hhmm(at)}`,
          minute: at - dayStart,
        });
        continue;
      }
    }

    const after = NOT_AFTER.exec(clause);
    if (after !== null) {
      const at = clockToMinutes(after[1] ?? "");
      if (at !== null) {
        understood.push({
          kind: "notAfter",
          label: `nothing after ${hhmm(at)}`,
          minute: at - dayStart,
        });
        continue;
      }
    }

    // Room rules are matched against real names, longest first, so "Room 2"
    // cannot swallow a clause that meant "Room 2B".
    const named = [...rooms.entries()]
      .sort(([, a], [, b]) => b.name.length - a.name.length)
      .find(
        ([, room]) =>
          clause.toLowerCase().includes(room.name.toLowerCase()) &&
          /\b(?:empty|free|avoid|not|no|skip|clear)\b/i.test(clause),
      );
    if (named !== undefined) {
      understood.push({
        kind: "avoidRoom",
        label: `keep ${named[1].name} empty`,
        roomIndex: named[0],
      });
      continue;
    }

    ignored.push(clause);
  }

  return { understood, ignored };
}

function hhmm(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  return `${String(hour).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Whether a proposed placement is allowed by every rule. */
export function allows(
  rules: Constraint[],
  slot: { minute: number; duration: number; roomIndex: number },
): boolean {
  const end = slot.minute + slot.duration;
  return rules.every((rule) => {
    if (rule.kind === "free") return !(slot.minute < rule.to && rule.from < end);
    if (rule.kind === "notBefore") return slot.minute >= rule.minute;
    if (rule.kind === "notAfter") return end <= rule.minute;
    return slot.roomIndex !== rule.roomIndex;
  });
}
