#!/usr/bin/env python3
"""MCP stdio server for the agent board.

Gives Claude Code and OpenCode native tools for talking to each other:

    board_post    send a message (broadcast or to one agent)
    board_read    read what arrived since your last read
    board_wait    block until a message arrives
    board_threads list conversation threads

Identity comes from the BOARD_AGENT environment variable, so one server
definition per agent. No dependencies, no network, protocol is newline
delimited JSON-RPC over stdio.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import board  # noqa: E402  (local module, path set above)

SERVER_NAME = "agent-board"
SERVER_VERSION = "1.0.0"
DEFAULT_PROTOCOL = "2025-06-18"


def identity() -> str:
    raw = os.environ.get("BOARD_AGENT") or "agent"
    try:
        return board.normalize_agent(raw)
    except ValueError:
        return "agent"


AGENT = identity()

TOOLS = [
    {
        "name": "board_post",
        "description": (
            "Post a message to the shared agent board that the other coding agents "
            "read. Use it to hand off work, answer a question, announce status, or "
            "ask for a decision. Omit 'to' to broadcast to everyone."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The message body. Plain text; keep it self-contained.",
                },
                "to": {
                    "type": "string",
                    "description": "Recipient agent name, e.g. 'claude' or 'opencode'. Omit to broadcast.",
                },
                "thread": {
                    "type": "string",
                    "description": "Optional topic/thread name, e.g. 'auth-api'.",
                },
                "kind": {
                    "type": "string",
                    "enum": ["message", "question", "answer", "task", "status", "blocked"],
                    "description": "Message type. Defaults to 'message'.",
                },
            },
            "required": ["text"],
        },
    },
    {
        "name": "board_read",
        "description": (
            "Read new messages addressed to you (plus broadcasts) since your last "
            "read. Reading acknowledges them, so each message is delivered once."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "description": "Maximum messages to return. Defaults to 20.",
                },
                "thread": {
                    "type": "string",
                    "description": "Only read this thread.",
                },
                "since": {
                    "type": "integer",
                    "description": "Override your saved cursor and read after this message id.",
                },
                "peek": {
                    "type": "boolean",
                    "description": "Do not advance your cursor, so messages can be read again.",
                },
            },
        },
    },
    {
        "name": "board_wait",
        "description": (
            "Block until a new message for you arrives, then return it. Use this "
            "after asking another agent a question when you need the answer before "
            "continuing. Returns an empty result when the timeout expires."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "timeout_seconds": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 600,
                    "description": "How long to wait. Defaults to 60 seconds.",
                },
                "thread": {
                    "type": "string",
                    "description": "Only wait on this thread.",
                },
                "peek": {
                    "type": "boolean",
                    "description": "Do not advance your cursor.",
                },
            },
        },
    },
    {
        "name": "board_threads",
        "description": "List board threads with message counts and last activity.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def reply(request_id, result=None, error=None) -> None:
    message = {"jsonrpc": "2.0", "id": request_id}
    if error is not None:
        message["error"] = error
    else:
        message["result"] = result
    emit(message)


def tool_result(text: str, is_error: bool = False) -> dict:
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


def call_tool(name: str, args: dict) -> dict:
    try:
        if name == "board_post":
            message = board.post(
                sender=AGENT,
                body=args.get("text", ""),
                recipient=args.get("to"),
                thread=args.get("thread"),
                kind=args.get("kind") or "message",
            )
            target = message["recipient"] or "everyone"
            return tool_result(
                f"Posted #{message['id']} to {target}.\n\n{board.format_message(message)}"
            )

        if name == "board_read":
            limit = args.get("limit", 20)
            try:
                limit = max(1, min(int(limit), 100))
            except (TypeError, ValueError):
                limit = 20
            messages = board.fetch(
                AGENT,
                since=args.get("since"),
                limit=limit,
                thread=args.get("thread"),
                peek=bool(args.get("peek")),
            )
            if not messages:
                return tool_result(f"No new messages for {AGENT}.")
            return tool_result(board.format_messages(messages))

        if name == "board_wait":
            try:
                timeout = float(args.get("timeout_seconds", 60))
            except (TypeError, ValueError):
                timeout = 60.0
            timeout = max(0.0, min(timeout, 600.0))
            messages, timed_out = board.wait_for(
                AGENT,
                timeout=timeout,
                thread=args.get("thread"),
                peek=bool(args.get("peek")),
            )
            if timed_out:
                return tool_result(
                    f"No new messages for {AGENT} after {timeout:g}s. "
                    "Check again later or continue with other work."
                )
            return tool_result(board.format_messages(messages))

        if name == "board_threads":
            return tool_result(board.format_threads(board.threads()))

        return tool_result(f"Unknown tool: {name}", is_error=True)
    except Exception as exc:  # noqa: BLE001 - surface every failure to the model
        return tool_result(f"{type(exc).__name__}: {exc}", is_error=True)


def handle(request: dict) -> None:
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}

    if method == "initialize":
        requested = params.get("protocolVersion") or DEFAULT_PROTOCOL
        reply(
            request_id,
            {
                "protocolVersion": requested,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                "instructions": (
                    f"You are '{AGENT}' on a shared message board. Use board_post to "
                    "send a message (broadcast by omitting 'to'), board_read to see "
                    "what arrived, and board_wait to block for a reply. Messages are "
                    "stored locally and shared with the other coding agents."
                ),
            },
        )
        return

    if method == "tools/list":
        reply(request_id, {"tools": TOOLS})
        return

    if method == "tools/call":
        result = call_tool(params.get("name", ""), params.get("arguments") or {})
        reply(request_id, result)
        return

    if method == "ping":
        reply(request_id, {})
        return

    if method in {
        "notifications/initialized",
        "notifications/cancelled",
        "notifications/progress",
    }:
        return

    if method and method.startswith("notifications/"):
        return

    reply(request_id, error={"code": -32601, "message": f"Method not found: {method}"})


def main() -> int:
    board.ensure_utf8_stdout()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            emit(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32700, "message": f"Parse error: {exc}"},
                }
            )
            continue
        for request in payload if isinstance(payload, list) else [payload]:
            if isinstance(request, dict):
                handle(request)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
