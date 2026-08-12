#!/usr/bin/env python3
"""Create the Gather epics and stories in Jira from docs/TICKETS.md.

Reads credentials from the environment — nothing is written to disk:

    JIRA_SITE     e.g. ordel.atlassian.net
    JIRA_EMAIL    the Atlassian account address
    JIRA_API_TOKEN
    JIRA_PROJECT  the project key, e.g. GAT

    python3 jira_push.py --dry-run     # parse and print, create nothing
    python3 jira_push.py               # create for real

Idempotent by summary: an issue whose summary already exists in the project is
skipped rather than duplicated, so a partial run can simply be repeated.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
from pathlib import Path

TICKETS = Path(__file__).resolve().parent.parent / "docs" / "TICKETS.md"

EPIC = re.compile(r"^## EPIC (E\d+) — (.+?)\s+([🟢🟡🔴])\s+(.*)$")
STORY = re.compile(r"^### (S[\d.]+) — (.+?)\s+([🟢🟡🔴])\s+(\w+)\s*(.*)$")
LABEL = re.compile(r"`([a-z0-9-]+)`")

PRIORITY = {"Highest": "Highest", "High": "High", "Medium": "Medium", "Low": "Low"}
STATE = {"🟢": "done", "🟡": "in progress", "🔴": "not started"}


def need(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value == "":
        sys.exit(f"{name} is not set. See the docstring at the top of this file.")
    return value


class Jira:
    def __init__(self, site: str, email: str, token: str) -> None:
        self.base = f"https://{site}/rest/api/3"
        raw = f"{email}:{token}".encode()
        self.auth = "Basic " + base64.b64encode(raw).decode()

    def call(self, path: str, body: dict | None = None, method: str = "GET") -> dict:
        # curl rather than urllib: this machine's Python has no CA bundle, and
        # a deploy-adjacent script is the wrong place to be disabling TLS
        # verification to work around it.
        command = [
            "curl", "-sS", "-X", method,
            "-H", f"Authorization: {self.auth}",
            "-H", "Accept: application/json",
            "-w", "\n%{http_code}",
            f"{self.base}{path}",
        ]
        if body is not None:
            command += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
        done = subprocess.run(
            command,
            input=None if body is None else json.dumps(body),
            capture_output=True,
            text=True,
            check=True,
        )
        raw, _, status = done.stdout.rpartition("\n")
        if not status.isdigit() or int(status) >= 300:
            raise SystemExit(f"{method} {path} -> {status}\n{raw[:600]}")
        return json.loads(raw) if raw.strip() else {}


def adf(text: str) -> dict:
    """Atlassian document format. Gherkin blocks stay as code blocks."""
    content: list[dict] = []
    for chunk in text.split("```"):
        chunk = chunk.strip()
        if chunk == "":
            continue
        if chunk.startswith("gherkin"):
            body = chunk[len("gherkin") :].strip()
            content.append(
                {
                    "type": "codeBlock",
                    "attrs": {"language": "gherkin"},
                    "content": [{"type": "text", "text": body}],
                }
            )
        else:
            for paragraph in chunk.split("\n\n"):
                flat = " ".join(paragraph.split())
                if flat:
                    content.append(
                        {"type": "paragraph", "content": [{"type": "text", "text": flat}]}
                    )
    if not content:
        content = [{"type": "paragraph", "content": []}]
    return {"type": "doc", "version": 1, "content": content}


def parse(path: Path) -> list[dict]:
    issues: list[dict] = []
    current: dict | None = None
    for line in path.read_text().splitlines():
        epic = EPIC.match(line)
        story = STORY.match(line)
        if epic:
            code, title, state, rest = epic.groups()
            current = {
                "kind": "Epic",
                "code": code,
                "summary": f"{code} — {title}",
                "labels": LABEL.findall(rest),
                "priority": "High",
                "state": STATE[state],
                "body": [],
            }
            issues.append(current)
        elif story:
            code, title, state, priority, rest = story.groups()
            current = {
                "kind": "Story",
                "code": code,
                "summary": f"{code} — {title}",
                "labels": LABEL.findall(rest),
                "priority": PRIORITY.get(priority, "Medium"),
                "state": STATE[state],
                "parent": issues and next(
                    (i["code"] for i in reversed(issues) if i["kind"] == "Epic"), None
                ),
                "body": [],
            }
            issues.append(current)
        elif current is not None and not line.startswith("## "):
            current["body"].append(line)
    for issue in issues:
        issue["description"] = "\n".join(issue["body"]).strip()
        del issue["body"]
    return issues


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--tickets", default=str(TICKETS))
    args = parser.parse_args()

    issues = parse(Path(args.tickets))
    epics = [i for i in issues if i["kind"] == "Epic"]
    stories = [i for i in issues if i["kind"] == "Story"]
    print(f"parsed {len(epics)} epics and {len(stories)} stories")

    if args.dry_run:
        for issue in issues:
            parent = f"  (child of {issue.get('parent')})" if issue.get("parent") else ""
            print(f"  [{issue['kind']:5}] {issue['summary']}{parent}")
            print(f"          labels={issue['labels']} priority={issue['priority']} {issue['state']}")
        return

    jira = Jira(need("JIRA_SITE"), need("JIRA_EMAIL"), need("JIRA_API_TOKEN"))
    project = need("JIRA_PROJECT")

    meta = jira.call(f"/issue/createmeta?projectKeys={project}&expand=projects.issuetypes")
    found = meta.get("projects") or []
    if not found:
        raise SystemExit(f"project {project} not visible to this account")
    types = {t["name"]: t["id"] for t in found[0]["issuetypes"]}
    print("issue types:", ", ".join(sorted(types)))

    # /search was removed in 2024; /search/jql pages by token rather than offset.
    existing = set()
    token = ""
    while True:
        suffix = f"&nextPageToken={token}" if token else ""
        page = jira.call(
            f"/search/jql?jql=project%3D{project}&fields=summary&maxResults=100{suffix}"
        )
        for row in page.get("issues", []):
            existing.add(row["fields"]["summary"])
        token = page.get("nextPageToken") or ""
        if token == "":
            break
    print(f"{len(existing)} issues already in {project}")

    created: dict[str, str] = {}
    for issue in issues:
        if issue["summary"] in existing:
            print(f"  skip (exists) {issue['summary']}")
            continue
        kind = issue["kind"] if issue["kind"] in types else "Task"
        fields: dict = {
            "project": {"key": project},
            "summary": issue["summary"][:255],
            "issuetype": {"id": types[kind]},
            "description": adf(issue["description"]),
            "labels": issue["labels"] + [issue["state"].replace(" ", "-")],
        }
        parent_code = issue.get("parent")
        if kind == "Story" and parent_code and parent_code in created:
            fields["parent"] = {"key": created[parent_code]}
        result = jira.call("/issue", {"fields": fields}, method="POST")
        created[issue["code"]] = result["key"]
        print(f"  {result['key']}  {issue['summary']}")

    print(f"\ncreated {len(created)} issues in {project}")
    for code, key in created.items():
        print(f"  {code} -> {key}")


if __name__ == "__main__":
    main()
