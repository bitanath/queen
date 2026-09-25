#!/usr/bin/env python3
"""Append a GGUF (plus an ELTHBLOB trailer) to a compiled executable.

The engine (elthur's core/hosts.zig) finds the model by reading the fixed
80-byte trailer at the end of the running executable and mmapping the bytes
recorded there. Appending is idempotent: if a valid trailer already exists the
file is truncated back to its original size first, so re-running the build
never stacks models.

Run from the local venv: .venv/bin/python3 scripts/append_model.py MODEL EXE
Standard library only; nothing is installed globally.
"""

from __future__ import annotations

import os
import shutil
import struct
import sys

MAGIC = b"ELTHBLOB"
VERSION = 1
ALIGN = 16384  # arm64 page size: keeps model_offset mmap-able
TRAILER = struct.Struct("<8sIIQQQQ32s")
assert TRAILER.size == 80


def align_up(value: int, align: int) -> int:
    return (value + align - 1) // align * align


def existing_before_size(exe: str) -> int | None:
    size = os.path.getsize(exe)
    if size < TRAILER.size:
        return None
    with open(exe, "rb") as f:
        f.seek(size - TRAILER.size)
        raw = f.read(TRAILER.size)
    magic, version, _flags, _moff, _mlen, _map, before, _digest = TRAILER.unpack(raw)
    if magic != MAGIC or version != VERSION:
        return None
    if before <= 0 or before > size:
        return None
    return before


def append(exe: str, model: str) -> None:
    before = existing_before_size(exe)
    if before is not None:
        os.truncate(exe, before)
        print(f"  re-append: truncated {exe} to {before} bytes")
    size = os.path.getsize(exe)
    model_offset = align_up(size, ALIGN)
    model_length = os.path.getsize(model)

    with open(exe, "ab") as out:
        if model_offset > size:
            out.write(b"\0" * (model_offset - size))
        with open(model, "rb") as src:
            shutil.copyfileobj(src, out, length=1 << 20)
        out.write(
            TRAILER.pack(
                MAGIC,
                VERSION,
                0,
                model_offset,
                model_length,
                align_up(model_length, ALIGN),
                size,
                b"\0" * 32,  # digest: all-zero = skip verification
            )
        )
    final = os.path.getsize(exe)
    print(
        f"  appended {model}: {model_length} bytes at offset {model_offset} "
        f"(exe {final} bytes)"
    )


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(f"usage: {argv[0]} <model.gguf> <executable>", file=sys.stderr)
        return 2
    model, exe = argv[1], argv[2]
    if not os.path.isfile(model):
        print(f"model not found: {model}", file=sys.stderr)
        return 1
    if not os.path.isfile(exe):
        print(f"executable not found: {exe}", file=sys.stderr)
        return 1
    append(exe, model)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
