#!/usr/bin/env python3
"""Extract a prototype's <style> block and scope every selector under an attribute.

`tools/dc2tsx.py` converts a `.dc.html` prototype's *markup* and drops `<helmet>`
and `<style>` — which is most of what the marketing landing is. This is the other
half: it lifts that stylesheet out and rewrites it so nothing escapes.

Scoping is not tidiness. A prototype styles `body`, `a`, `h1` and `nav` globally,
because in the design tool it is the only thing on the page. Unscoped in an app,
the landing's near-black background and its `a{color:inherit}` repaint every
console screen, and `nav{position:fixed}` pins somebody else's header.

Three rules, and they are the whole of it:

  :root / html / body   ->  the scope itself
  html.js X             ->  html.js <scope> X          (the reveal start state
                            has to keep matching <html>)
  everything else       ->  <scope> prefixed
  @keyframes            ->  left alone; percentages are not selectors

Comments ride in the prelude and are *not* part of the selector. Missing that put
`/* nav */` inside a selector and left the `nav` rule after it unscoped — which
is `position:fixed` on every nav in the app, and is why this is a file rather
than a one-off.

Usage:
  python tools/dcstyle.py "GatherDesign/Gather Landing.dc.html" \\
      apps/web/src/styles/marketing.css "[data-marketing]"
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

STYLE = re.compile(r"<style>(.*?)</style>", re.S)
COMMENT = re.compile(r"/\*.*?\*/", re.S)
#: Selectors that describe the page itself rather than something inside it.
ROOTS = ("html", "body", ":root")


def split_prelude(prelude: str) -> tuple[str, str]:
    notes = COMMENT.findall(prelude)
    return " ".join(note.strip() for note in notes), COMMENT.sub("", prelude).strip()


def scope_one(selector: str, scope: str) -> str:
    text = selector.strip()
    if not text:
        return text
    if text in ROOTS:
        return scope
    if text.startswith("html.js "):
        return f"html.js {scope} {text[len('html.js '):]}"
    for root in ROOTS:
        if text.startswith(f"{root}:") or text.startswith(f"{root} "):
            return scope + text[len(root) :]
    return f"{scope} {text}"


def scope_list(raw: str, scope: str) -> str:
    return ", ".join(scope_one(part, scope) for part in raw.split(",") if part.strip())


def convert(css: str, scope: str) -> str:
    out: list[str] = []
    index, length = 0, len(css)
    while index < length:
        brace = css.find("{", index)
        if brace == -1:
            break
        notes, head = split_prelude(css[index:brace])

        depth, cursor = 0, brace
        while cursor < length:
            if css[cursor] == "{":
                depth += 1
            elif css[cursor] == "}":
                depth -= 1
                if depth == 0:
                    break
            cursor += 1
        body = css[brace + 1 : cursor]

        if notes:
            out.append(f"\n{notes}")
        if head.startswith("@keyframes"):
            out.append(f"{head} {{{body}}}")
        elif head.startswith(("@media", "@supports")):
            inner: list[str] = []
            at = 0
            while at < len(body):
                open_at = body.find("{", at)
                if open_at == -1:
                    break
                inner_notes, inner_head = split_prelude(body[at:open_at])
                close_at = body.find("}", open_at)
                if inner_notes:
                    inner.append(inner_notes)
                inner.append(
                    f"{scope_list(inner_head, scope)} {{{body[open_at + 1 : close_at].strip()}}}"
                )
                at = close_at + 1
            out.append(f"{head} {{\n  " + "\n  ".join(inner) + "\n}")
        else:
            out.append(f"{scope_list(head, scope)} {{{body}}}")
        index = cursor + 1
    return "\n".join(out)


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    source, target, scope = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]

    block = STYLE.search(source.read_text())
    if block is None:
        print(f"no <style> block in {source}", file=sys.stderr)
        return 1
    scoped = convert(block.group(1).strip(), scope)

    # next/font hashes the family name, so a literal one would never match. The
    # prototype names its face directly because it loads it from Google.
    scoped = re.sub(
        r"font-family:\s*Manrope,",
        '/* next/font hashes the family name; the literal "Manrope" never matches. */\n'
        "  font-family:var(--font-manrope),",
        scoped,
    )

    leaked = [
        line
        for line in scoped.splitlines()
        if "{" in line and not line.lstrip().startswith(("@", "/*", "}", scope, "html.js"))
    ]
    if leaked:
        print(f"{len(leaked)} selector(s) escaped the scope:", file=sys.stderr)
        for line in leaked[:5]:
            print(f"  {line[:100]}", file=sys.stderr)
        return 1

    header = (
        f"/* GENERATED from {source.name} by tools/dcstyle.py. Do not hand-edit —\n"
        f" * change the prototype's <style> block and re-run:\n"
        f" *\n"
        f' *   python tools/dcstyle.py "{source}" {target} "{scope}"\n'
        f" *\n"
        f" * Every selector is scoped to {scope}; see the tool for why that is\n"
        f" * load-bearing rather than tidy. Tokens for other surfaces live in their\n"
        f" * own files so a regeneration cannot take them with it.\n"
        f" */\n\n"
    )
    target.write_text(header + scoped + "\n")
    print(f"{source.name} -> {target} ({len(scoped.splitlines())} rules, scoped to {scope})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
