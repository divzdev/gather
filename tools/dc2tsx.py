#!/usr/bin/env python3
"""Convert a GatherDesign .dc.html prototype into a React component, verbatim.

The point is fidelity, not interpretation. Markup, inline styles, spacing and copy
come across exactly as authored; nothing is summarised, reordered or "improved".

What it handles:
  style="a:b;c:d"      -> style={{a: "b", c: "d"}} with camelCased properties
  style-hover="..."    -> a generated CSS rule on a hashed class, since React has
                          no inline :hover
  class=/for=          -> className=/htmlFor=
  SVG kebab attributes -> camelCase (stroke-width -> strokeWidth)
  void elements        -> self-closed
  <sc-if>              -> unwrapped (its conditions default to shown)
  <x-dc>, <helmet>     -> dropped; fonts and shell live in app/layout.tsx
  <script type=x-dc>   -> dropped; behaviour is supplied by the wrapper component

data-rv and data-count are left on the elements. A small client component drives
them, so the reveal and count-up behave as they do in the prototype.

Usage: python tools/dc2tsx.py "GatherDesign/Gather Landing.dc.html" out.tsx Landing
"""

from __future__ import annotations

import hashlib
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
# Dropped with their contents.
DROP_TAGS = {"helmet", "script", "style", "link", "meta", "title"}
# Removed, but their children are kept: these are wrappers, not content.
UNWRAP_TAGS = {"x-dc", "sc-if", "sc-else", "html", "head", "body"}

ATTR_MAP = {
    "class": "className",
    "for": "htmlFor",
    "tabindex": "tabIndex",
    "colspan": "colSpan",
    "rowspan": "rowSpan",
    "maxlength": "maxLength",
    "readonly": "readOnly",
    "autocomplete": "autoComplete",
    "srcset": "srcSet",
    "contenteditable": "contentEditable",
}

KEEP_DASHED = ("data-", "aria-")

# HTMLParser lowercases attribute names, so the camelCase SVG and HTML ones have
# to be restored by hand. React rejects the lowercase spellings.
CASED = {
    "viewbox": "viewBox",
    "preserveaspectratio": "preserveAspectRatio",
    "strokewidth": "strokeWidth",
    "strokelinecap": "strokeLinecap",
    "strokelinejoin": "strokeLinejoin",
    "strokedasharray": "strokeDasharray",
    "strokedashoffset": "strokeDashoffset",
    "strokeopacity": "strokeOpacity",
    "strokemiterlimit": "strokeMiterlimit",
    "fillrule": "fillRule",
    "fillopacity": "fillOpacity",
    "cliprule": "clipRule",
    "clippath": "clipPath",
    "gradientunits": "gradientUnits",
    "gradienttransform": "gradientTransform",
    "stopcolor": "stopColor",
    "stopopacity": "stopOpacity",
    "patternunits": "patternUnits",
    "markerend": "markerEnd",
    "markerstart": "markerStart",
    "textanchor": "textAnchor",
    "dominantbaseline": "dominantBaseline",
    "spreadmethod": "spreadMethod",
    "xlink:href": "xlinkHref",
    "crossorigin": "crossOrigin",
    "srcset": "srcSet",
    "datetime": "dateTime",
}


def camel(name: str) -> str:
    head, *rest = name.split("-")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)


def style_to_object(raw: str) -> str:
    parts = []
    for chunk in split_declarations(raw):
        if ":" not in chunk:
            continue
        prop, _, value = chunk.partition(":")
        prop, value = prop.strip(), value.strip()
        if not prop or not value:
            continue
        key = prop if prop.startswith("--") else camel(prop)
        quoted = value.replace("\\", "\\\\").replace('"', '\\"')
        parts.append(f'"{key}": "{quoted}"' if prop.startswith("--") else f'{key}: "{quoted}"')
    return "{" + ", ".join(parts) + "}"


def split_declarations(raw: str) -> list[str]:
    """Split on semicolons that are not inside brackets, so gradients survive."""
    out, depth, current = [], 0, ""
    for char in raw:
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        if char == ";" and depth == 0:
            out.append(current)
            current = ""
        else:
            current += char
    if current.strip():
        out.append(current)
    return out


class Converter(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self.hover_rules: dict[str, str] = {}
        self.skip_depth = 0
        self.stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.skip_depth:
            # Void tags never close, so counting them would strand the skip depth
            # and swallow the rest of the document.
            if tag not in VOID:
                self.skip_depth += 1
            return
        if tag in DROP_TAGS:
            self.skip_depth = 1
            return
        if tag in UNWRAP_TAGS:
            self.stack.append("__unwrap__")
            return

        rendered = []
        classes: list[str] = []
        for name, value in attrs:
            value = value or ""
            if name.startswith("hint-") or name == "ref" or value.strip().startswith("{{"):
                continue
            if name == "style-hover":
                token = hashlib.md5(value.encode()).hexdigest()[:8]
                cls = f"dch-{token}"
                self.hover_rules[cls] = value
                classes.append(cls)
                continue
            if name == "style":
                rendered.append(f"style={{{style_to_object(value)}}}")
                continue
            if name == "class":
                classes.append(value)
                continue
            if name.startswith(KEEP_DASHED):
                rendered.append(f'{name}="{value}"')
                continue
            attr = ATTR_MAP.get(name) or CASED.get(name) or camel(name)
            # Always emit a string: a bare attribute becomes `true`, which React
            # rejects for string-typed props like `viewBox`.
            rendered.append(f'{attr}="{value}"')

        if classes:
            rendered.insert(0, f'className="{" ".join(classes)}"')

        attrs_text = (" " + " ".join(rendered)) if rendered else ""
        if tag in VOID:
            self.out.append(f"<{tag}{attrs_text} />")
        else:
            self.out.append(f"<{tag}{attrs_text}>")
            self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if self.skip_depth:
            self.skip_depth -= 1
            return
        if tag in DROP_TAGS or tag in VOID:
            return
        if tag in UNWRAP_TAGS:
            if self.stack and self.stack[-1] == "__unwrap__":
                self.stack.pop()
            return
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
            self.out.append(f"</{tag}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in VOID and self.stack and self.stack[-1] == tag:
            self.stack.pop()
            self.out.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if self.skip_depth or not data.strip():
            if not self.skip_depth and data.strip("\n\t ") == "" and "\n" in data:
                self.out.append(" ")
            return
        text = data.replace("{", "&#123;").replace("}", "&#125;")
        self.out.append(text)

    def handle_comment(self, data: str) -> None:
        # Dropped: an HTML comment in JSX children renders as literal text.
        return

    def handle_entityref(self, name: str) -> None:
        if not self.skip_depth:
            self.out.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if not self.skip_depth:
            self.out.append(f"&#{name};")


def convert(path: Path, component: str) -> str:
    parser = Converter()
    parser.feed(path.read_text(encoding="utf-8"))

    body = "".join(parser.out).strip()
    hover_css = "\n".join(
        f".{cls}:hover{{{rules}}}" for cls, rules in sorted(parser.hover_rules.items())
    )

    return f'''"use client";

/* GENERATED from {path.name} by tools/dc2tsx.py. Do not hand-edit.
 * Re-run the converter when the design changes. Behaviour (scroll reveals,
 * count-up) comes from DesignMotion; the markup below is the prototype verbatim. */

import {{ DesignMotion }} from "@/components/DesignMotion";

const HOVER_CSS = `{hover_css}`;

export function {component}() {{
  return (
    <DesignMotion css={{HOVER_CSS}}>
      {body}
    </DesignMotion>
  );
}}
'''


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: dc2tsx.py <input.dc.html> <output.tsx> <ComponentName>")
    source, target, component = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(convert(source, component), encoding="utf-8")
    print(f"{source.name} -> {target} ({target.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
