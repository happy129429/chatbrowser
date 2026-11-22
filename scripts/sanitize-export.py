#!/usr/bin/env python3
"""Deterministic sanitizer for chat export JSON.

- keeps keys, types, array lengths and enum-like structural values
- replaces text/content/names/summaries/URLs/emails with placeholders
- remaps timestamps while preserving ordering and deltas
- remaps UUID-like ids consistently across all input files
- never adds or removes fields; validates the shape afterwards

Usage:
  python3 scripts/sanitize-export.py input.json [more.json ...] --out-dir sanitized \
      [--map private-map.json] [--time-ref 1600000000]

Keep the optional map file private; never upload it with the sanitized data.
"""

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT_UUID = "00000000-0000-4000-8000-000000000000"
STRUCTURAL_KEYS = {
    "type",
    "role",
    "sender",
    "status",
    "source",
    "injection_source",
    "cut_off",
    "truncated",
    "hidden",
    "thinking_hidden",
    "initial_turn_only",
    "skip_on_truncated_continuation",
    "alternative_display_type",
    "enable_thinking",
    "reasoning_effort",
    "archived",
    "pinned",
    "message_version",
    "flags",
    "mime_type",
}
ID_KEYS = {
    "id",
    "uuid",
    "conversation_id",
    "parent_message_uuid",
    "parentId",
    "currentId",
    "file_uuid",
    "user_id",
    "account_id",
    "project_id",
    "workspace_id",
    "share_id",
    "folder_id",
    "tool_use_id",
    "message_id",
}
TIME_KEYS = {
    "timestamp",
    "created_at",
    "updated_at",
    "start_timestamp",
    "stop_timestamp",
    "inserted_at",
    "timestamp_start",
    "timestamp_end",
    "date",
}
FILE_NAME_KEYS = {"file_name", "filename", "name"}
URL_RE = re.compile(r"^https?://", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.\w+")
ISO_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$"
)
CJK_RE = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")


class Sanitizer:
    def __init__(self, time_ref: int):
        self.time_ref = dt.datetime.fromtimestamp(time_ref, tz=dt.timezone.utc)
        self.text_map = {}
        self.id_map = {}
        self.file_count = 0
        self.next_text = 1
        self.next_id = 1
        self.next_file = 1

    def text(self, value: str) -> str:
        if value not in self.text_map:
            self.text_map[value] = f"[TEXT_{self.next_text:04d}]"
            self.next_text += 1
        return self.text_map[value]

    def ident(self, value: str) -> str:
        if value == ROOT_UUID:
            return value
        if value not in self.id_map:
            self.id_map[value] = f"00000000-0000-4000-8000-{self.next_id:012d}"
            self.next_id += 1
        return self.id_map[value]

    def file_name(self, value: str) -> str:
        suffix = Path(value).suffix
        self.next_file += 1
        return f"file_{self.next_file:03d}{suffix}"

    def timestamp(self, value, key):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            mapped = int(self.time_ref.timestamp()) + (value - int(self.time_ref.timestamp()))
            return int(round(mapped)) if isinstance(value, int) else mapped
        if isinstance(value, str):
            match = ISO_RE.match(value)
            if not match:
                return self.text(value)
            year, month, day, hour, minute, second, fraction, zone = match.groups()
            parsed = dt.datetime(
                int(year),
                int(month),
                int(day),
                int(hour),
                int(minute),
                int(second),
                tzinfo=dt.timezone.utc,
            )
            delta = parsed - self.time_ref
            mapped = self.time_ref + delta
            micro = (fraction or "").ljust(6, "0")[:6]
            return (
                mapped.strftime("%Y-%m-%dT%H:%M:%S")
                + (f".{micro}" if fraction else "")
                + "Z"
            )
        return value

    def value(self, value, key=None, parent_key=None):
        if isinstance(value, dict):
            return {k: self.value(v, k, parent_key if parent_key is not None else key) for k, v in value.items()}
        if isinstance(value, list):
            return [self.value(v, key, parent_key) for v in value]
        if isinstance(value, bool) or value is None:
            return value
        if isinstance(value, (int, float)):
            if key in TIME_KEYS:
                return self.timestamp(value, key)
            return value
        if not isinstance(value, str):
            return value
        if key in STRUCTURAL_KEYS:
            return value
        if key in ID_KEYS:
            return self.ident(value)
        if key in TIME_KEYS:
            return self.timestamp(value, key)
        if key in FILE_NAME_KEYS and Path(value).suffix:
            return self.file_name(value)
        if URL_RE.match(value):
            return self.text(value)
        if EMAIL_RE.search(value):
            return self.text(value)
        return self.text(value)


def shape(value, path="$"):
    if isinstance(value, dict):
        return ("dict", tuple((k, shape(v, f"{path}.{k}")) for k, v in value.items()))
    if isinstance(value, list):
        return ("list", len(value), tuple(shape(v, f"{path}[]") for v in value))
    return (type(value).__name__,)


def find_cjk(value, path="$", hits=None):
    hits = [] if hits is None else hits
    if isinstance(value, dict):
        for k, v in value.items():
            find_cjk(v, f"{path}.{k}", hits)
    elif isinstance(value, list):
        for item in value:
            find_cjk(item, path + "[]", hits)
    elif isinstance(value, str) and CJK_RE.search(value):
        hits.append((path, value[:40]))
    return hits


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--out-dir", type=Path, default=Path("sanitized"))
    parser.add_argument("--map", type=Path, default=None)
    parser.add_argument("--time-ref", type=int, default=1600000000)
    parser.add_argument(
        "--drop-keys",
        nargs="*",
        default=[],
        help="field names to remove entirely (use only for fields you know are not in the real schema)",
    )
    args = parser.parse_args()

    sanitizer = Sanitizer(args.time_ref)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    failed = False
    drop_keys = set(args.drop_keys)

    def drop(value):
        if isinstance(value, dict):
            return {k: drop(v) for k, v in value.items() if k not in drop_keys}
        if isinstance(value, list):
            return [drop(v) for v in value]
        return value

    for source in args.inputs:
        original = drop(json.loads(source.read_text(encoding="utf-8")))
        cleaned = sanitizer.value(original)
        if shape(original) != shape(cleaned):
            print(f"shape mismatch after sanitizing {source}", file=sys.stderr)
            failed = True
            continue
        cjk = find_cjk(cleaned)
        if cjk:
            print(f"unreplaced CJK strings in {source}: {cjk[:3]}", file=sys.stderr)
            failed = True
        target = args.out_dir / source.name
        target.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{source} -> {target} ({len(cleaned) if isinstance(cleaned, list) else 1} top-level)")
    if args.map:
        args.map.write_text(
            json.dumps({"ids": sanitizer.id_map, "texts": sanitizer.text_map}, ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )
        print(f"private map written to {args.map} (do not share)")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
