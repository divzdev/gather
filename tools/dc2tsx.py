#!/usr/bin/env python3
"""Convert a GatherDesign .dc.html prototype into a React component, verbatim.

The point is fidelity, not interpretation. Markup, inline styles, spacing and copy
come across exactly as authored; nothing is summarised, reordered or "improved".

Structure and styling:
  style="a:b;c:d"      -> style={{a: "b", c: "d"}} with camelCased properties
  style-hover="..."    -> a generated CSS rule on a hashed class, since React has
                          no inline :hover
  class=/for=          -> className=/htmlFor=
  SVG kebab attributes -> camelCase (stroke-width -> strokeWidth)
  void elements        -> self-closed
  <x-dc>, <helmet>     -> dropped; fonts and shell live in app/layout.tsx
  <script type=x-dc>   -> dropped; behaviour is supplied by the wrapper component

Data, from the prototype's own binding syntax:
  {{ path }}                    -> {d.path}, the seam where live data goes in
  <sc-for list="{{ xs }}" as="x"> -> {(d.xs ?? []).map((x, i) => ...)}
  <sc-if value="{{ c }}">       -> {d.c ? (...) : null}

Every binding's use tells you its type — text is a node, on* is a handler, an
sc-if condition is a boolean — so the converter also emits the data type the
screen requires. Wiring a screen to the API is then a type error until it's done.

data-rv and data-count are left on the elements. DesignMotion drives them, so the
reveal and count-up behave as they do in the prototype.

Usage: python tools/dc2tsx.py "GatherDesign/Overview.dc.html" out.tsx Overview
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
# Dropped with their contents.
DROP_TAGS = {"helmet", "script", "style", "link", "meta", "title"}
# Removed, but their children are kept: these are wrappers, not content.
UNWRAP_TAGS = {"x-dc", "html", "head", "body"}

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

# HTMLParser lowercases attribute names, so the camelCase SVG, HTML and event
# ones have to be restored by hand. React rejects the lowercase spellings.
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
    "datetime": "dateTime",
    "onclick": "onClick",
    "onchange": "onChange",
    "oninput": "onInput",
    "onsubmit": "onSubmit",
    "onfocus": "onFocus",
    "onblur": "onBlur",
    "onkeydown": "onKeyDown",
    "onkeyup": "onKeyUp",
    "onmouseenter": "onMouseEnter",
    "onmouseleave": "onMouseLeave",
    "onmousedown": "onMouseDown",
    "onmouseup": "onMouseUp",
    "ondoubleclick": "onDoubleClick",
    "ondblclick": "onDoubleClick",
    "oncontextmenu": "onContextMenu",
    "ondragstart": "onDragStart",
    "ondragover": "onDragOver",
    "ondragend": "onDragEnd",
    "ondrop": "onDrop",
    "onpointerdown": "onPointerDown",
    "onpointerup": "onPointerUp",
    "onpointermove": "onPointerMove",
    "onwheel": "onWheel",
    "onscroll": "onScroll",
}

# The prototypes link to each other by filename. Every screen carries the same
# map, so it lives here rather than being patched per screen after conversion.
ROUTES = {
    "Gather Landing.dc.html": "/",
    "Overview.dc.html": "/admin",
    "Submissions.dc.html": "/admin/submissions",
    "Review.dc.html": "/admin/review",
    "Evaluations.dc.html": "/admin/review",
    "Sessions.dc.html": "/admin/sessions",
    "Speakers.dc.html": "/admin/speakers",
    "Agenda.dc.html": "/admin/agenda",
    "Tasks.dc.html": "/admin/tasks",
    "Messages.dc.html": "/admin/messages",
    "Forms.dc.html": "/admin/forms",
    "Embeds.dc.html": "/admin/publishing",
    "Settings.dc.html": "/admin/settings",
    "Portal.dc.html": "/portal",
    "Auth.dc.html": "/login",
    "CFP.dc.html": "/e/devflow-2027/cfp",
    "Event Landing.dc.html": "/e/devflow-2027",
}

# <dc-import name="X"> is the prototype's component include. Each maps to a
# controller that supplies the generated component's data.
DC_IMPORTS = {"ConsoleRail": ("Rail", "@/components/console/Rail")}

BINDING = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")
LITERAL = re.compile(r"^(true|false|null|undefined|-?\d+(\.\d+)?|'[^']*'|\"[^\"]*\")$")
PATH = re.compile(r"^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$")

# A binding's type follows from where it is used. Ordered by precedence, so a
# path used two ways resolves to the more specific one.
KIND_TS = {
    "list": None,  # structural — rendered as an array of the item's own shape
    "handler": "(event: React.SyntheticEvent) => void",
    "aria": '"true" | "false" | "mixed"',
    "bool": "boolean",
    "text": "string",
    "node": "React.ReactNode",
}
KIND_ORDER = list(KIND_TS)

# React types these as a tri-state union rather than a free string.
ARIA_TRISTATE = {"aria-checked", "aria-pressed", "aria-selected", "aria-expanded"}

# HTML writes these as text; React types them as numbers.
NUMERIC_ATTRS = {
    "rows", "cols", "size", "span", "start", "maxLength", "minLength",
    "tabIndex", "colSpan", "rowSpan",
}


def camel(name: str) -> str:
    head, *rest = name.split("-")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)


def attr_literal(name: str, value: str) -> str:
    """A JSX attribute whose value may itself contain a double quote.

    `placeholder="a "b" c"` closes the attribute early and corrupts the rest of
    the document, so anything with a quote is emitted as an expression instead.
    """
    if '"' in value:
        return f"{name}={{{json.dumps(value)}}}"
    return f'{name}="{value}"'


def js_quote(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


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
        # (source tag, closing text, alias frame) — the source tag is what the
        # parser will report on close, which is not always what we emitted.
        self.stack: list[tuple[str, str, tuple[str, str] | None]] = []
        self.types: dict[str, str] = {}
        self.uses_link = False
        self.imported: dict[str, str] = {}

    @staticmethod
    def internal_link(attrs: list[tuple[str, str | None]]) -> bool:
        href = dict(attrs).get("href") or ""
        return href in ROUTES

    # -- bindings ---------------------------------------------------------

    @property
    def aliases(self) -> dict[str, str]:
        """Loop variable -> the canonical path of the list it iterates."""
        return {frame[0]: frame[1] for _, _, frame in self.stack if frame is not None}

    def resolve(self, expr: str, kind: str) -> str:
        """Rewrite a prototype expression into JSX and record the type it implies."""
        expr = expr.strip()
        if LITERAL.match(expr) or not PATH.match(expr):
            return expr
        root, _, rest = expr.partition(".")
        aliases = self.aliases
        if root in aliases:
            self.note_type(f"{aliases[root]}[]{'.' + rest if rest else ''}", kind)
            return expr
        self.note_type(expr, kind)
        return f"d.{expr}"

    def note_type(self, path: str, kind: str) -> None:
        current = self.types.get(path)
        if current is None or KIND_ORDER.index(kind) < KIND_ORDER.index(current):
            self.types[path] = kind

    def interpolate(self, raw: str, kind: str) -> str | None:
        """A value with bindings becomes a JSX expression; a plain one stays None."""
        matches = list(BINDING.finditer(raw))
        if not matches:
            return None
        if len(matches) == 1 and matches[0].group(0) == raw.strip():
            return self.resolve(matches[0].group(1), kind)
        parts = BINDING.sub(lambda m: "${" + self.resolve(m.group(1), "text") + "}", raw)
        return "`" + parts.replace("`", "\\`") + "`"

    def style_to_object(self, raw: str) -> str:
        parts = []
        for chunk in split_declarations(raw):
            if ":" not in chunk:
                continue
            prop, _, value = chunk.partition(":")
            prop, value = prop.strip(), value.strip()
            if not prop or not value:
                continue
            key = f'"{prop}"' if prop.startswith("--") else camel(prop)
            bound = self.interpolate(value, "text")
            parts.append(f"{key}: {bound}" if bound else f'{key}: "{js_quote(value)}"')
        return "{" + ", ".join(parts) + "}"

    # -- parsing ----------------------------------------------------------

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
            self.stack.append((tag, "", None))
            return
        if tag == "dc-import":
            self.open_import(dict(attrs))
            return
        if tag == "sc-for":
            self.open_for(dict(attrs))
            return
        if tag == "sc-if":
            self.open_if(dict(attrs))
            return

        rendered: list[str] = []
        classes: list[str] = []
        class_expr: str | None = None
        for name, raw in attrs:
            value = raw or ""
            if name.startswith("hint-") or name == "ref":
                continue
            if name == "style-hover":
                token = hashlib.md5(value.encode()).hexdigest()[:8]
                self.hover_rules[f"dch-{token}"] = value
                classes.append(f"dch-{token}")
                continue
            if name == "style":
                rendered.append(f"style={{{self.style_to_object(value)}}}")
                continue
            if name == "class":
                bound = self.interpolate(value, "text")
                if bound:
                    class_expr = bound
                else:
                    classes.append(value)
                continue

            if name == "href" and value in ROUTES:
                rendered.append(attr_literal("href", ROUTES[value]))
                continue
            kind = (
                "handler"
                if name.startswith("on")
                else "aria"
                if name in ARIA_TRISTATE
                else "text"
            )
            bound = self.interpolate(value, kind)
            attr = name if name.startswith(KEEP_DASHED) else (
                ATTR_MAP.get(name) or CASED.get(name) or camel(name)
            )
            # Always emit a string when there is no binding: a bare attribute
            # becomes `true`, which React rejects for string-typed props.
            if bound:
                rendered.append(f"{attr}={{{bound}}}")
            elif attr in NUMERIC_ATTRS and value.strip().lstrip("-").isdigit():
                rendered.append(f"{attr}={{{value.strip()}}}")
            else:
                rendered.append(attr_literal(attr, value))

        if classes or class_expr:
            literal = " ".join(classes)
            if class_expr is None:
                rendered.insert(0, attr_literal("className", literal))
            elif literal:
                rendered.insert(0, f'className={{`{literal} ${{{class_expr}}}`}}')
            else:
                rendered.insert(0, f"className={{{class_expr}}}")

        emitted = "Link" if tag == "a" and self.internal_link(attrs) else tag
        if emitted == "Link":
            self.uses_link = True
        attrs_text = (" " + " ".join(rendered)) if rendered else ""
        if tag in VOID:
            self.out.append(f"<{tag}{attrs_text} />")
        else:
            self.out.append(f"<{emitted}{attrs_text}>")
            self.stack.append((tag, f"</{emitted}>", None))

    def open_import(self, attrs: dict[str, str | None]) -> None:
        name = (attrs.get("name") or "").strip()
        if name not in DC_IMPORTS:
            raise SystemExit(f"unmapped <dc-import name=\"{name}\"> — add it to DC_IMPORTS")
        component, module = DC_IMPORTS[name]
        self.imported[component] = module
        props = [f'active="{attrs["active"]}"'] if attrs.get("active") else []
        if attrs.get("style"):
            props.append(f"style={{{self.style_to_object(attrs['style'] or '')}}}")
        self.out.append(f"<{component} {' '.join(props)} />")
        self.stack.append(("dc-import", "", None))

    def open_for(self, attrs: dict[str, str | None]) -> None:
        match = BINDING.search(attrs.get("list") or "")
        alias = (attrs.get("as") or "item").strip()
        if match is None:
            self.stack.append(("sc-for", "", None))
            return
        expr = self.resolve(match.group(1), "list")
        canonical = expr[2:] if expr.startswith("d.") else expr
        self.out.append(f"{{({expr} ?? []).map(({alias}, {alias}Index) => (<Fragment key={{{alias}Index}}>")
        self.stack.append(("sc-for", "</Fragment>))}", (alias, canonical)))

    def open_if(self, attrs: dict[str, str | None]) -> None:
        match = BINDING.search(attrs.get("value") or "")
        if match is None:
            self.stack.append(("sc-if", "", None))
            return
        self.out.append(f"{{{self.resolve(match.group(1), 'bool')} ? (<>")
        self.stack.append(("sc-if", "</>) : null}", None))

    def handle_endtag(self, tag: str) -> None:
        if self.skip_depth:
            self.skip_depth -= 1
            return
        if tag in DROP_TAGS or tag in VOID:
            return
        if self.stack and self.stack[-1][0] == tag:
            _, closer, _ = self.stack.pop()
            self.out.append(closer)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        if not data.strip():
            if data.strip("\n\t ") == "" and "\n" in data:
                self.out.append(" ")
            return
        cursor = 0
        for match in BINDING.finditer(data):
            self.out.append(self.escape_text(data[cursor : match.start()]))
            self.out.append(f"{{{self.resolve(match.group(1), 'node')}}}")
            cursor = match.end()
        self.out.append(self.escape_text(data[cursor:]))

    @staticmethod
    def escape_text(text: str) -> str:
        return text.replace("{", "&#123;").replace("}", "&#125;")

    def handle_comment(self, data: str) -> None:
        # Dropped: an HTML comment in JSX children renders as literal text.
        return

    def handle_entityref(self, name: str) -> None:
        if not self.skip_depth:
            self.out.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if not self.skip_depth:
            self.out.append(f"&#{name};")


def build_type(paths: dict[str, str], prefix: str = "", indent: str = "  ") -> str:
    """Turn the recorded binding paths into a TypeScript object type."""
    fields: dict[str, tuple[str | None, dict[str, str]]] = {}
    for path, kind in paths.items():
        if prefix and not path.startswith(prefix):
            continue
        rest = path[len(prefix) :]
        if not rest:
            continue
        head, _, tail = rest.partition(".")
        name, is_list = (head[:-2], True) if head.endswith("[]") else (head, False)
        own_kind, children = fields.setdefault(name, (None, {}))
        if is_list or tail:
            children[path] = kind
        else:
            fields[name] = (kind, children)
        if is_list:
            fields[name] = ("list", children)

    lines = []
    for name, (kind, children) in sorted(fields.items()):
        if kind == "list":
            shape = build_type(children, f"{prefix}{name}[].", indent + "  ")
            lines.append(f"{indent}readonly {name}: readonly {shape}[];")
        elif children:
            shape = build_type(children, f"{prefix}{name}.", indent + "  ")
            lines.append(f"{indent}readonly {name}: {shape};")
        else:
            lines.append(f"{indent}readonly {name}: {KIND_TS[kind or 'node']};")
    if not lines:
        return "Record<string, never>"
    closing = indent[:-2]
    return "{\n" + "\n".join(lines) + f"\n{closing}}}"


def convert(path: Path, component: str) -> str:
    parser = Converter()
    parser.feed(path.read_text(encoding="utf-8"))

    body = "".join(parser.out).strip()
    hover_css = "\n".join(
        f".{cls}:hover{{{rules}}}" for cls, rules in sorted(parser.hover_rules.items())
    )
    shape = build_type(parser.types)
    uses_data = shape != "Record<string, never>"
    uses_fragment = "<Fragment " in body

    imports = ["import { DesignMotion } from \"@/components/DesignMotion\";"]
    for imported, module in sorted(parser.imported.items()):
        imports.append(f'import {{ {imported} }} from "{module}";')
    if parser.uses_link:
        imports.insert(0, 'import Link from "next/link";')
    if uses_fragment:
        imports.insert(0, 'import { Fragment } from "react";')
    signature = f"{{ d }}: {{ d: {component}Data }}" if uses_data else ""
    data_type = f"\nexport type {component}Data = {shape};\n" if uses_data else ""

    return f'''"use client";

/* GENERATED from {path.name} by tools/dc2tsx.py. Do not hand-edit — change the
 * design and re-run the converter. Behaviour (scroll reveals, count-up) comes
 * from DesignMotion; the markup below is the prototype verbatim, with its
 * {{{{ }}}} bindings turned into the props declared above. */

{chr(10).join(imports)}
{data_type}
const HOVER_CSS = `{hover_css}`;

export function {component}({signature}) {{
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
