#!/usr/bin/env python3
"""Asana REST helper. Python 3 stdlib only, no dependencies.

    ASANA_TOKEN=<personal access token> python3 asana_client.py list <project_gid>

The fallback for when the Asana MCP server isn't connected (headless / cron /
non-interactive runs, where the MCP OAuth flow can't complete). A personal access
token from Asana → Settings → Apps → Developer needs no callback and works
unattended.

Identity rule: everything written with this token is attributed to the token's
owner. Move/complete/assign are fine (task-state edits), and so are image
attachments with no text (the ticket convention, playbook §10). Comments are a
speech act in the user's voice — `comment()` is here only so `delete_story()` can
undo an accidental one; don't post on the user's behalf.
"""
import json
import mimetypes
import os
import sys
import urllib.request
import uuid

BASE = "https://app.asana.com/api/1.0"
UPLOAD_TIMEOUT = 90  # seconds; an upload without a timeout can hang for minutes


def token():
    value = os.environ.get("ASANA_TOKEN", "")
    if not value:
        raise RuntimeError("set ASANA_TOKEN")
    return value


def api(path, data=None, method=None):
    """One request. GET by default; pass `data` (dict) for a POST/PUT body."""
    body = json.dumps({"data": data}).encode() if data is not None else None
    req = urllib.request.Request(
        f"{BASE}/{path.lstrip('/')}",
        data=body,
        method=method or ("POST" if data is not None else "GET"),
    )
    req.add_header("Authorization", f"Bearer {token()}")
    if body:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as r:
        return json.load(r)


# --- reads -------------------------------------------------------------------

def me():
    """Cheapest call that proves the token works."""
    return api("users/me")["data"]


def sections(project_gid):
    """Board columns and their gids — needed before moving a task."""
    return api(f"projects/{project_gid}/sections")["data"]


def list_tasks(project_gid):
    """Project tasks with their current board column (memberships[].section.name)."""
    fields = "name,completed,notes,memberships.section.name,permalink_url"
    return api(f"tasks?project={project_gid}&opt_fields={fields}&limit=100")["data"]


def task(gid):
    return api(f"tasks/{gid}?opt_fields=name,notes,permalink_url")["data"]


def attachments(gid):
    """Attachments; each `download_url` is a signed, short-lived asset URL — fetch promptly.

    For Marker.io tickets the real screenshot is here; the files.marker.io link in
    the notes is auth-walled and returns HTML, not the image.
    """
    return api(f"tasks/{gid}/attachments?opt_fields=name,download_url,view_url")["data"]


def section_of(t):
    """The task's current board column from a list_tasks() row, or '' if none."""
    memberships = t.get("memberships") or [{}]
    return (memberships[0].get("section") or {}).get("name", "")


# --- writes (task-state only) ------------------------------------------------

def move(task_gid, section_gid):
    """Move a task into a board column. A column is a *section*; this is NOT a task
    field update — there is no `section` field to PUT."""
    return api(f"sections/{section_gid}/addTask", {"task": task_gid})


def complete(gid, done=True):
    return api(f"tasks/{gid}", {"completed": done}, method="PUT")


# --- tickets (board convention, playbook §10) --------------------------------

def create_task(project_gid, name, html_notes, due_on=None):
    """Create a ticket named 'NN · Title'. It lands in the project's default column;
    place it with move_in_order()."""
    data = {"name": name, "html_notes": html_notes, "projects": [project_gid]}
    if due_on:
        data["due_on"] = due_on
    return api("tasks", data)["data"]


def attach(task_gid, path):
    """Attach an image (source screenshot or before/after) to a task. No comment
    text goes with it, so nothing is said in the user's voice."""
    boundary = uuid.uuid4().hex
    filename = os.path.basename(path)
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        content = f.read()
    body = b"".join([
        f'--{boundary}\r\nContent-Disposition: form-data; name="parent"\r\n\r\n{task_gid}\r\n'.encode(),
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n".encode(),
        content,
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(f"{BASE}/attachments", data=body, method="POST")
    req.add_header("Authorization", f"Bearer {token()}")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(req, timeout=UPLOAD_TIMEOUT) as r:
        return json.load(r)["data"]


def ticket_number(name):
    """'07 · Title' -> 7. Tasks without a leading number sort last."""
    prefix = name.split(" ", 1)[0]
    return int(prefix) if prefix.isdigit() else float("inf")


def move_in_order(task_gid, section_gid):
    """Move a task into a column, keeping the column in ascending ticket order.
    addTask with no position drops the task at the top, and insert_before /
    insert_after must name a task already in that column."""
    number = ticket_number(task(task_gid)["name"])
    others = [t for t in api(f"sections/{section_gid}/tasks?opt_fields=name")["data"]
              if t["gid"] != task_gid]
    later = [t for t in others if ticket_number(t["name"]) > number]
    data = {"task": task_gid}
    if later:
        data["insert_before"] = later[0]["gid"]
    elif others:
        data["insert_after"] = others[-1]["gid"]
    return api(f"sections/{section_gid}/addTask", data)


# --- speech acts (see identity rule) -----------------------------------------

def comment(gid, text):  # noqa: D401 — intentionally discouraged
    """Post a comment. Attributed to the token owner — avoid; prefer surfacing the
    blocker in chat. Present so an accidental comment can be undone with delete_story()."""
    return api(f"tasks/{gid}/stories", {"text": text})


def delete_story(story_gid):
    """Remove a story/comment your token authored (undo an accidental comment)."""
    return api(f"stories/{story_gid}", method="DELETE")


# --- tiny CLI ----------------------------------------------------------------

if __name__ == "__main__":
    args = sys.argv[1:]
    cmd = args[0] if args else "me"
    if cmd == "me":
        print(me()["name"])
    elif cmd == "sections":
        for s in sections(args[1]):
            print(s["gid"], s["name"])
    elif cmd == "list":
        rows = list_tasks(args[1])
        by_section = {}
        for t in rows:
            by_section.setdefault(section_of(t) or "(no section)", []).append(t)
        for name, ts in by_section.items():
            print(f"## {name} ({len(ts)})")
            for t in ts:
                print(f"  {t['gid']}  {t['name']}")
    elif cmd == "move":  # move <task_gid> <section_gid>
        move(args[1], args[2])
        print(f"moved {args[1]} -> section {args[2]}")
    elif cmd == "move-in-order":  # move-in-order <task_gid> <section_gid>
        move_in_order(args[1], args[2])
        print(f"moved {args[1]} -> section {args[2]}, in number order")
    elif cmd == "attach":  # attach <task_gid> <image path>
        print("attached", attach(args[1], args[2])["name"])
    elif cmd == "complete":
        complete(args[1])
        print(f"completed {args[1]}")
    elif cmd == "attachments":
        for a in attachments(args[1]):
            print(a.get("name"), "|", a.get("download_url") or a.get("view_url"))
    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)
