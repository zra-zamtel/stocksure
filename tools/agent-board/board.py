#!/usr/bin/env python3
"""Agent board - a tiny, dependency-free message board for AI coding agents.

Two agents on the same machine (for example Claude Code and OpenCode) share a
single SQLite file. Each agent has a read cursor, so it only sees messages it
has not read yet. Messages are either broadcasts or addressed to one agent.

Everything is stdlib, works offline, and lives next to this script.

    python board.py post --from claude --to opencode --text "Auth API is ready"
    python board.py read --as opencode
    python board.py wait --as opencode --timeout 120
    python board.py threads
    python board.py serve --port 8765

Set AGENT_BOARD_DB to point at a different database file.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import textwrap
import threading
import time
import webbrowser
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("AGENT_BOARD_DB") or (HERE / "board.db"))
MAX_BODY = 100_000
MAX_LIMIT = 1_000

_AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    sender      TEXT NOT NULL,
    recipient   TEXT,
    thread      TEXT,
    kind        TEXT NOT NULL DEFAULT 'message',
    body        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient, id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread, id);
CREATE TABLE IF NOT EXISTS cursors (
    agent       TEXT PRIMARY KEY,
    last_id     INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
);
"""


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def ensure_utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def normalize_agent(value: str) -> str:
    name = (value or "").strip().lower()
    if not _AGENT_RE.match(name):
        raise ValueError(
            f"invalid agent name {value!r}: use 1-32 letters, digits, '-' or '_'"
        )
    return name


def normalize_recipient(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"", "all", "*", "everyone", "any"}:
        return None
    return normalize_agent(text)


def normalize_thread(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if not text:
        return None
    text = re.sub(r"[^a-z0-9_.-]+", "-", text).strip("-")
    return text[:40] or None


def normalize_kind(value) -> str:
    text = (value or "message").strip().lower()
    text = re.sub(r"[^a-z0-9-]+", "-", text).strip("-")
    return (text or "message")[:16]


def connect() -> sqlite3.Connection:
    """Open the database, retrying while another process holds the setup lock.

    Two agents can start at the same instant; switching a fresh file to WAL is
    the only operation that needs a brief exclusive lock, so retry that instead
    of failing the agent's tool call.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    last_error: sqlite3.OperationalError | None = None
    for attempt in range(6):
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA busy_timeout=30000")
            conn.execute("PRAGMA journal_mode=WAL").fetchone()
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.executescript(SCHEMA)
            return conn
        except sqlite3.OperationalError as exc:
            conn.close()
            last_error = exc
            time.sleep(0.15 * (attempt + 1))
    raise last_error  # type: ignore[misc]


def row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "sender": row["sender"],
        "recipient": row["recipient"],
        "thread": row["thread"],
        "kind": row["kind"],
        "body": row["body"],
    }


# --------------------------------------------------------------------------- #
# core
# --------------------------------------------------------------------------- #

def post(sender, body, recipient=None, thread=None, kind="message") -> dict:
    sender = normalize_agent(sender)
    body = (body or "").strip()
    if not body:
        raise ValueError("message body is empty")
    if len(body) > MAX_BODY:
        raise ValueError(f"message body is longer than {MAX_BODY} characters")
    recipient = normalize_recipient(recipient)
    thread = normalize_thread(thread)
    kind = normalize_kind(kind)

    with closing(connect()) as conn:
        cur = conn.execute(
            "INSERT INTO messages (created_at, sender, recipient, thread, kind, body)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (now_iso(), sender, recipient, thread, kind, body),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM messages WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return row_to_dict(row)


def get_cursor(agent: str) -> int:
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT last_id FROM cursors WHERE agent = ?", (agent,)
        ).fetchone()
    return int(row["last_id"]) if row else 0


def set_cursor(agent: str, message_id: int) -> None:
    current = get_cursor(agent)
    if message_id <= current:
        return
    with closing(connect()) as conn:
        conn.execute(
            "INSERT INTO cursors (agent, last_id, updated_at) VALUES (?, ?, ?)"
            " ON CONFLICT(agent) DO UPDATE SET"
            " last_id = excluded.last_id, updated_at = excluded.updated_at",
            (agent, message_id, now_iso()),
        )
        conn.commit()


def fetch(
    agent,
    since=None,
    limit=50,
    thread=None,
    include_own=False,
    peek=False,
) -> list[dict]:
    """Return messages visible to *agent* after its cursor (or *since*)."""
    agent = normalize_agent(agent)
    limit = max(1, min(int(limit), MAX_LIMIT))
    thread = normalize_thread(thread)
    start = int(since) if since is not None else get_cursor(agent)

    clauses = ["id > ?"]
    params: list = [start]
    if not include_own:
        clauses.append("sender != ?")
        params.append(agent)
    clauses.append("(recipient IS NULL OR recipient = ?)")
    params.append(agent)
    if thread:
        clauses.append("thread = ?")
        params.append(thread)
    params.append(limit)

    sql = (
        "SELECT * FROM messages WHERE "
        + " AND ".join(clauses)
        + " ORDER BY id ASC LIMIT ?"
    )
    with closing(connect()) as conn:
        rows = conn.execute(sql, params).fetchall()
    messages = [row_to_dict(row) for row in rows]

    if messages and not peek:
        set_cursor(agent, messages[-1]["id"])
    return messages


def wait_for(
    agent,
    timeout=60,
    interval=0.5,
    thread=None,
    peek=False,
) -> tuple[list[dict], bool]:
    """Poll for new messages until one arrives or *timeout* seconds pass."""
    deadline = time.monotonic() + max(0.0, float(timeout))
    while True:
        messages = fetch(agent, thread=thread, peek=peek)
        if messages:
            return messages, False
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return [], True
        time.sleep(min(max(0.05, interval), remaining))


def threads() -> list[dict]:
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT thread, COUNT(*) AS count, MAX(id) AS last_id,"
            " MAX(created_at) AS last_at"
            " FROM messages WHERE thread IS NOT NULL"
            " GROUP BY thread ORDER BY last_id DESC"
        ).fetchall()
    return [
        {
            "thread": row["thread"],
            "count": row["count"],
            "last_id": row["last_id"],
            "last_at": row["last_at"],
        }
        for row in rows
    ]


def recent(limit=200, since=None, thread=None) -> list[dict]:
    """All messages for the web UI, oldest first."""
    limit = max(1, min(int(limit), MAX_LIMIT))
    thread = normalize_thread(thread)
    clauses = []
    params: list = []
    if since is not None:
        clauses.append("id > ?")
        params.append(int(since))
    if thread:
        clauses.append("thread = ?")
        params.append(thread)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM messages" + where + " ORDER BY id DESC LIMIT ?", params
        ).fetchall()
    return [row_to_dict(row) for row in reversed(rows)]


def status() -> dict:
    with closing(connect()) as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM messages").fetchone()["n"]
        by_sender = {
            row["sender"]: row["n"]
            for row in conn.execute(
                "SELECT sender, COUNT(*) AS n FROM messages GROUP BY sender"
            )
        }
        cursors = {
            row["agent"]: row["last_id"]
            for row in conn.execute("SELECT agent, last_id FROM cursors")
        }
        latest = conn.execute("SELECT MAX(id) AS n FROM messages").fetchone()["n"] or 0
    return {
        "db": str(DB_PATH),
        "messages": total,
        "latest_id": latest,
        "by_sender": by_sender,
        "cursors": cursors,
    }


# --------------------------------------------------------------------------- #
# formatting
# --------------------------------------------------------------------------- #

def format_message(message: dict) -> str:
    target = message["recipient"] or "all"
    bits = [
        f"#{message['id']}",
        message["created_at"],
        f"{message['sender']} -> {target}",
        message["kind"],
    ]
    if message["thread"]:
        bits.append(f"thread={message['thread']}")
    head = " | ".join(bits)
    body = textwrap.indent(message["body"], "    ")
    return f"{head}\n{body}"


def format_messages(messages: list[dict]) -> str:
    return "\n\n".join(format_message(message) for message in messages)


def format_threads(rows: list[dict]) -> str:
    if not rows:
        return "No threads yet."
    lines = ["THREAD                   COUNT  LAST"]
    for row in rows:
        lines.append(
            f"{('#' + row['thread']):24} {row['count']:>5}  {row['last_at']}"
        )
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def read_body(args) -> str:
    if args.text is not None:
        if args.text == "-":
            return sys.stdin.read()
        if args.text.startswith("@") and len(args.text) > 1:
            return Path(args.text[1:]).read_text(encoding="utf-8")
        return args.text
    if args.file:
        return Path(args.file).read_text(encoding="utf-8")
    if args.words:
        return " ".join(args.words)
    if not sys.stdin.isatty():
        return sys.stdin.read()
    raise SystemExit("error: pass --text, --file, positional words, or pipe on stdin")


def cmd_post(args) -> int:
    message = post(
        sender=args.sender,
        body=read_body(args),
        recipient=args.to,
        thread=args.thread,
        kind=args.kind,
    )
    if args.json:
        print(json.dumps(message, ensure_ascii=False, indent=2))
    else:
        print(
            f"posted #{message['id']} by {message['sender']} -> "
            f"{message['recipient'] or 'all'}"
            + (f" (thread={message['thread']})" if message["thread"] else "")
        )
    return 0


def cmd_read(args) -> int:
    messages = fetch(
        args.agent,
        since=args.since,
        limit=args.limit,
        thread=args.thread,
        include_own=args.include_own,
        peek=args.peek,
    )
    if args.json:
        print(json.dumps(messages, ensure_ascii=False, indent=2))
    elif messages:
        print(format_messages(messages))
    else:
        print(f"No new messages for {normalize_agent(args.agent)}.")
    return 0


def cmd_wait(args) -> int:
    messages, timed_out = wait_for(
        args.agent,
        timeout=args.timeout,
        interval=args.interval,
        thread=args.thread,
        peek=args.peek,
    )
    if args.json:
        print(
            json.dumps(
                {"messages": messages, "timed_out": timed_out},
                ensure_ascii=False,
                indent=2,
            )
        )
    elif timed_out:
        print(
            f"No new messages for {normalize_agent(args.agent)} "
            f"after {args.timeout:g}s."
        )
    else:
        print(format_messages(messages))
    return 2 if timed_out else 0


def cmd_threads(args) -> int:
    rows = threads()
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        print(format_threads(rows))
    return 0


def cmd_status(args) -> int:
    print(json.dumps(status(), ensure_ascii=False, indent=2))
    return 0


# --------------------------------------------------------------------------- #
# web UI
# --------------------------------------------------------------------------- #

INDEX_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Board</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23090b0f'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%2357d98a'/%3E%3C/svg%3E">
<style>
  :root {
    --bg: #090b0f;
    --panel: #11151b;
    --panel-2: #0d1116;
    --line: #1e2631;
    --text: #e7edf5;
    --muted: #8492a6;
    --claude: #f0a23c;
    --opencode: #38cfe0;
    --human: #57d98a;
    --system: #a78bfa;
    --accent: var(--system);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--line);
    background: rgba(9, 11, 15, .86);
    backdrop-filter: blur(8px);
  }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 650; letter-spacing: .14em; font-size: 12px; }
  .pulse {
    width: 8px; height: 8px; border-radius: 50%; background: var(--human);
    box-shadow: 0 0 0 0 rgba(87, 217, 138, .5);
    animation: pulse 2.4s ease-out infinite;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(87, 217, 138, .45); }
    70% { box-shadow: 0 0 0 9px rgba(87, 217, 138, 0); }
    100% { box-shadow: 0 0 0 0 rgba(87, 217, 138, 0); }
  }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
  .brand span.sub { color: var(--muted); font-weight: 500; letter-spacing: .04em; }
  .head-right { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--muted); }
  .status { display: inline-flex; align-items: center; gap: 6px; }
  .status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
  .status.ok::before { background: var(--human); }
  .status.bad::before { background: #ef4444; }
  .count {
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; color: var(--text);
  }
  main { flex: 1; overflow-y: auto; scroll-behavior: smooth; }
  .feed { max-width: 940px; margin: 0 auto; padding: 22px 18px 40px; display: flex; flex-direction: column; gap: 10px; }
  .msg {
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    background: linear-gradient(180deg, rgba(255,255,255,.018), transparent 60%), var(--panel);
    border-radius: 10px;
    padding: 11px 14px 12px;
    animation: enter .18s ease-out;
  }
  @keyframes enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .msg[hidden] { display: none; }
  .b-claude { --accent: var(--claude); }
  .b-opencode { --accent: var(--opencode); }
  .b-human { --accent: var(--human); }
  .b-system, .b-agent { --accent: var(--system); }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11.5px; color: var(--muted); }
  .badge {
    color: var(--accent); font-weight: 700; letter-spacing: .04em; text-transform: lowercase;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
    border-radius: 999px; padding: 1px 9px; font-size: 11px;
  }
  .arrow { color: #4b5869; }
  .to { color: var(--text); opacity: .78; }
  .kind {
    text-transform: lowercase; border: 1px solid var(--line); border-radius: 5px;
    padding: 0 6px; font-size: 10.5px; letter-spacing: .03em;
  }
  .kind.k-question { color: #fbbf24; border-color: #4a3612; }
  .kind.k-answer { color: #34d399; border-color: #123a2b; }
  .kind.k-task { color: #93c5fd; border-color: #1b2f4d; }
  .kind.k-status { color: var(--muted); }
  .thread { color: #7dd3fc; opacity: .75; }
  time { margin-left: auto; font-variant-numeric: tabular-nums; }
  .body {
    margin-top: 7px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: ui-monospace, "Cascadia Code", Consolas, "SF Mono", monospace;
    font-size: 13.5px;
    line-height: 1.58;
    color: #dbe4ef;
  }
  .empty { text-align: center; color: var(--muted); padding: 72px 20px; line-height: 1.7; }
  .empty strong { display: block; color: var(--text); font-size: 15px; margin-bottom: 4px; }
  footer {
    border-top: 1px solid var(--line);
    background: var(--panel-2);
    padding: 12px 16px 14px;
  }
  .composer { max-width: 940px; margin: 0 auto; display: flex; flex-direction: column; gap: 8px; }
  .composer-top { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
  select, textarea, button { font: inherit; color: inherit; }
  select {
    background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
    padding: 4px 8px; color: var(--text); outline: none;
  }
  .composer-row { display: flex; gap: 10px; align-items: flex-end; }
  textarea {
    flex: 1; resize: none; min-height: 44px; max-height: 180px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
    padding: 11px 12px; outline: none; line-height: 1.5;
  }
  textarea:focus, select:focus { border-color: #35506b; box-shadow: 0 0 0 3px rgba(56, 207, 224, .08); }
  button {
    background: #e7edf5; color: #0b0e13; border: 0; border-radius: 8px;
    padding: 0 20px; height: 44px; font-weight: 650; cursor: pointer;
  }
  button:hover { background: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  .hint { color: #5c6a7d; font-size: 11px; }
  @media (max-width: 560px) {
    header { padding: 12px 14px; }
    .brand span.sub { display: none; }
    .feed { padding: 14px 10px 28px; }
    .msg { padding: 10px 11px; }
  }
</style>
</head>
<body>
<header>
  <div class="brand"><span class="pulse"></span> AGENT BOARD <span class="sub">claude &middot; opencode</span></div>
  <div class="head-right">
    <span id="status" class="status">connecting</span>
    <span id="count" class="count">0</span>
  </div>
</header>

<main id="scroller">
  <div class="feed" id="feed">
    <div class="empty" id="empty">
      <strong>No messages yet</strong>
      An agent can post with <code>board_post</code>, or use the box below.
    </div>
  </div>
</main>

<footer>
  <div class="composer">
    <div class="composer-top">
      <span>Send as <strong style="color:var(--human)">human</strong></span>
      <span class="arrow">&rarr;</span>
      <select id="to" aria-label="Recipient">
        <option value="">everyone</option>
        <option value="claude">claude</option>
        <option value="opencode">opencode</option>
      </select>
      <select id="thread-filter" aria-label="Filter by thread">
        <option value="">all threads</option>
      </select>
    </div>
    <div class="composer-row">
      <textarea id="text" placeholder="Message the agents...  (Ctrl+Enter to send)" aria-label="Message"></textarea>
      <button id="send">Send</button>
    </div>
    <div class="hint">Shared locally over tools/agent-board/board.db &middot; refreshes every 2s</div>
  </div>
</footer>

<script>
const feed = document.getElementById('feed');
const scroller = document.getElementById('scroller');
const empty = document.getElementById('empty');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const threadFilter = document.getElementById('thread-filter');
const toSel = document.getElementById('to');
const textEl = document.getElementById('text');
const sendBtn = document.getElementById('send');

const state = { rendered: 0, filter: '', first: true };

function badgeClass(name) {
  return 'b-' + String(name || 'system').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function makeMessage(m) {
  const article = document.createElement('article');
  article.className = 'msg';
  article.dataset.thread = m.thread || '';
  article.dataset.id = String(m.id);

  const meta = document.createElement('div');
  meta.className = 'meta';

  const from = document.createElement('span');
  from.className = 'badge ' + badgeClass(m.sender);
  from.textContent = m.sender;

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '\u2192';

  const to = document.createElement('span');
  to.className = 'to';
  to.textContent = m.recipient || 'all';

  const kind = document.createElement('span');
  kind.className = 'kind k-' + String(m.kind || 'message').toLowerCase().replace(/[^a-z0-9-]/g, '');
  kind.textContent = m.kind;

  meta.append(from, arrow, to, kind);

  if (m.thread) {
    const thread = document.createElement('span');
    thread.className = 'thread';
    thread.textContent = '#' + m.thread;
    meta.append(thread);
  }

  const time = document.createElement('time');
  time.textContent = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  time.title = m.created_at;
  meta.append(time);

  const body = document.createElement('div');
  body.className = 'body';
  body.textContent = m.body;

  article.append(meta, body);
  return article;
}

function applyFilter() {
  let visible = 0;
  for (const node of feed.querySelectorAll('.msg')) {
    const show = !state.filter || node.dataset.thread === state.filter;
    node.hidden = !show;
    if (show) visible += 1;
  }
  empty.hidden = visible > 0;
  countEl.textContent = String(state.rendered);
}

async function loadThreads() {
  try {
    const res = await fetch('/api/threads', { cache: 'no-store' });
    const rows = await res.json();
    const current = threadFilter.value;
    threadFilter.innerHTML = '<option value="">all threads</option>';
    for (const row of rows) {
      const option = document.createElement('option');
      option.value = row.thread;
      option.textContent = '#' + row.thread + ' (' + row.count + ')';
      threadFilter.append(option);
    }
    threadFilter.value = current;
  } catch (err) {
    /* the poll indicator already reports connection problems */
  }
}

async function poll() {
  try {
    const res = await fetch('/api/messages?limit=500', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const messages = await res.json();
    const fresh = messages.filter((m) => m.id > state.rendered);
    if (fresh.length) {
      const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 180;
      for (const message of fresh) feed.append(makeMessage(message));
      state.rendered = fresh[fresh.length - 1].id;
      if (nearBottom || state.first) scroller.scrollTop = scroller.scrollHeight;
      state.first = false;
      loadThreads();
    }
    statusEl.textContent = 'live';
    statusEl.className = 'status ok';
    applyFilter();
  } catch (err) {
    statusEl.textContent = 'offline';
    statusEl.className = 'status bad';
  }
}

async function send() {
  const text = textEl.value.trim();
  if (!text) return;
  sendBtn.disabled = true;
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'human', to: toSel.value || null, text }),
    });
    if (!res.ok) throw new Error(await res.text());
    textEl.value = '';
    await poll();
    scroller.scrollTop = scroller.scrollHeight;
  } catch (err) {
    alert('Could not send: ' + err.message);
  } finally {
    sendBtn.disabled = false;
    textEl.focus();
  }
}

sendBtn.addEventListener('click', send);
textEl.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    send();
  }
});
threadFilter.addEventListener('change', () => {
  state.filter = threadFilter.value;
  applyFilter();
});

loadThreads();
poll();
setInterval(poll, 2000);
</script>
</body>
</html>
"""


class BoardHandler(BaseHTTPRequestHandler):
    server_version = "AgentBoard/1.0"

    def log_message(self, fmt, *args):  # keep the console quiet
        return

    def _send(self, code: int, body: str, content_type: str) -> None:
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, payload, code: int = 200) -> None:
        self._send(code, json.dumps(payload, ensure_ascii=False), "application/json")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path in ("/", "/index.html"):
                self._send(200, INDEX_HTML, "text/html")
            elif parsed.path == "/health":
                self._json({"ok": True, **status()})
            elif parsed.path == "/api/messages":
                limit = int(query.get("limit", ["200"])[0])
                since = int(query["since"][0]) if "since" in query else None
                thread = query.get("thread", [None])[0]
                self._json(recent(limit=limit, since=since, thread=thread))
            elif parsed.path == "/api/threads":
                self._json(threads())
            else:
                self._json({"error": "not found"}, 404)
        except (TypeError, ValueError) as exc:
            self._json({"error": str(exc)}, 400)
        except Exception as exc:  # pragma: no cover - defensive
            self._json({"error": f"{type(exc).__name__}: {exc}"}, 500)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/messages":
            self._json({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > 1_000_000:
                self._json({"error": "payload too large"}, 413)
                return
            payload = json.loads(self.rfile.read(length) or b"{}")
            message = post(
                sender=payload.get("sender") or "human",
                body=payload.get("text") or payload.get("body") or "",
                recipient=payload.get("to") or payload.get("recipient"),
                thread=payload.get("thread"),
                kind=payload.get("kind") or "message",
            )
            self._json(message, 201)
        except (json.JSONDecodeError, ValueError, TypeError) as exc:
            self._json({"error": str(exc)}, 400)
        except Exception as exc:  # pragma: no cover - defensive
            self._json({"error": f"{type(exc).__name__}: {exc}"}, 500)


def cmd_serve(args) -> int:
    server = ThreadingHTTPServer((args.host, args.port), BoardHandler)
    server.daemon_threads = True
    url = f"http://{'127.0.0.1' if args.host in {'0.0.0.0', '::'} else args.host}:{args.port}/"
    print(f"Agent board UI: {url}")
    print(f"Database:       {DB_PATH}")
    print("Press Ctrl+C to stop.")
    if args.open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="board.py",
        description="Shared message board for coding agents.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    post_p = sub.add_parser("post", help="post a message")
    post_p.add_argument("--from", dest="sender", required=True, help="your agent name")
    post_p.add_argument("--to", default=None, help="recipient (omit to broadcast)")
    post_p.add_argument("--thread", default=None, help="optional thread name")
    post_p.add_argument("--kind", default="message", help="message, question, answer, task, status...")
    post_p.add_argument("--text", "-t", default=None, help="message text, '-' for stdin, '@file' to read a file")
    post_p.add_argument("--file", default=None, help="read the message from a file")
    post_p.add_argument("words", nargs="*", help="message words (alternative to --text)")
    post_p.add_argument("--json", action="store_true", help="print the stored message as JSON")
    post_p.set_defaults(func=cmd_post)

    read_p = sub.add_parser("read", help="read new messages addressed to you")
    read_p.add_argument("--as", dest="agent", required=True)
    read_p.add_argument("--since", type=int, default=None, help="override the saved cursor")
    read_p.add_argument("--limit", type=int, default=50)
    read_p.add_argument("--thread", default=None)
    read_p.add_argument("--include-own", action="store_true", help="also return your own messages")
    read_p.add_argument("--peek", action="store_true", help="do not advance your cursor")
    read_p.add_argument("--json", action="store_true")
    read_p.set_defaults(func=cmd_read)

    wait_p = sub.add_parser("wait", help="block until a new message arrives")
    wait_p.add_argument("--as", dest="agent", required=True)
    wait_p.add_argument("--timeout", type=float, default=60.0, help="seconds to wait (default 60)")
    wait_p.add_argument("--interval", type=float, default=0.5, help="poll interval in seconds")
    wait_p.add_argument("--thread", default=None)
    wait_p.add_argument("--peek", action="store_true", help="do not advance your cursor")
    wait_p.add_argument("--json", action="store_true")
    wait_p.set_defaults(func=cmd_wait)

    threads_p = sub.add_parser("threads", help="list threads")
    threads_p.add_argument("--json", action="store_true")
    threads_p.set_defaults(func=cmd_threads)

    status_p = sub.add_parser("status", help="show board statistics")
    status_p.set_defaults(func=cmd_status)

    serve_p = sub.add_parser("serve", help="start the web UI")
    serve_p.add_argument("--host", default="127.0.0.1")
    serve_p.add_argument("--port", type=int, default=8765)
    serve_p.add_argument("--open", action="store_true", help="open the browser")
    serve_p.set_defaults(func=cmd_serve)

    return parser


def main(argv=None) -> int:
    ensure_utf8_stdout()
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
