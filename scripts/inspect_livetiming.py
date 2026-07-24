from __future__ import annotations

import argparse
import ast
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def parse_line(line: str) -> tuple[str, Any, str] | None:
    line = line.strip()
    if not line:
        return None

    try:
        category, payload, timestamp = ast.literal_eval(line)
    except (SyntaxError, ValueError):
        return None

    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            pass

    return str(category), payload, str(timestamp)


def preview(value: Any, max_chars: int) -> str:
    text = json.dumps(value, indent=2, sort_keys=True, default=str)
    if len(text) > max_chars:
        return text[:max_chars].rstrip() + "\n..."
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description="Preview FastF1 live timing recording files.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--examples", type=int, default=1, help="Examples to show per category.")
    parser.add_argument("--max-chars", type=int, default=1200, help="Maximum characters per example payload.")
    args = parser.parse_args()

    counts: Counter[str] = Counter()
    examples: dict[str, list[tuple[str, Any]]] = defaultdict(list)
    malformed = 0

    with args.file.open() as fobj:
        for line in fobj:
            parsed = parse_line(line)
            if parsed is None:
                malformed += 1
                continue
            category, payload, timestamp = parsed
            counts[category] += 1
            if len(examples[category]) < args.examples:
                examples[category].append((timestamp, payload))

    print(f"file: {args.file}")
    print(f"categories: {len(counts)}")
    print(f"malformed lines: {malformed}")
    print()
    print("category counts")
    for category, count in counts.most_common():
        print(f"  {category}: {count}")

    for category in sorted(examples):
        print()
        print(f"## {category}")
        for timestamp, payload in examples[category]:
            print(f"timestamp: {timestamp or '<initial snapshot>'}")
            print(preview(payload, args.max_chars))


if __name__ == "__main__":
    main()
