#!/usr/bin/env python3
"""
Regenerate src/i18n/zh-TW.ts from en + zh-CN structure.

- Tree shape always matches en (and zh-CN).
- Leaf strings: keep existing zh-TW value when present; otherwise OpenCC s2twp from zh-CN.
- Interpolation placeholders {{...}} are left intact.

Usage (from repo root):
  yarn i18n:sync-zh-TW
  # or: python3 scripts/sync-zh-TW-i18n.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

try:
    import opencc
except ImportError:
    print("error: python package opencc required (pip install opencc-python-reimplemented / opencc)", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "i18n" / "zh-TW.ts"


def export_json() -> tuple[dict, dict, dict]:
    """Export translation trees via node/tsx."""
    script = r"""
import { writeFileSync } from 'node:fs'
import { en } from './src/i18n/en.ts'
import { zhCN } from './src/i18n/zh-CN.ts'
import { zhTW } from './src/i18n/zh-TW.ts'
writeFileSync('tmp/i18n-en.json', JSON.stringify(en.translation))
writeFileSync('tmp/i18n-zh-CN.json', JSON.stringify(zhCN.translation))
writeFileSync('tmp/i18n-zh-TW-old.json', JSON.stringify(zhTW.translation))
"""
    (ROOT / "tmp").mkdir(exist_ok=True)
    subprocess.check_call(
        ["node", "--import", "tsx", "-e", script],
        cwd=ROOT,
    )
    en = json.loads((ROOT / "tmp/i18n-en.json").read_text())
    cn = json.loads((ROOT / "tmp/i18n-zh-CN.json").read_text())
    tw = json.loads((ROOT / "tmp/i18n-zh-TW-old.json").read_text())
    return en, cn, tw


def convert_str(converter: opencc.OpenCC, s: str) -> str:
    """Convert Simplified→Taiwan Traditional, preserving {{placeholders}}."""
    out: list[str] = []
    buf: list[str] = []
    i = 0
    while i < len(s):
        if s.startswith("{{", i):
            if buf:
                out.append(converter.convert("".join(buf)))
                buf = []
            j = s.find("}}", i)
            if j < 0:
                buf.append(s[i])
                i += 1
                continue
            out.append(s[i : j + 2])
            i = j + 2
        else:
            buf.append(s[i])
            i += 1
    if buf:
        out.append(converter.convert("".join(buf)))
    return "".join(out)


def merge(en_node, cn_node, tw_node, converter: opencc.OpenCC):
    if not isinstance(en_node, dict):
        if isinstance(tw_node, type(en_node)) and isinstance(tw_node, str) and tw_node.strip():
            return tw_node
        if isinstance(cn_node, str):
            return convert_str(converter, cn_node)
        if cn_node is not None and type(cn_node) is type(en_node):
            return cn_node
        return en_node

    cn_d = cn_node if isinstance(cn_node, dict) else {}
    tw_d = tw_node if isinstance(tw_node, dict) else {}
    return {k: merge(v, cn_d.get(k), tw_d.get(k), converter) for k, v in en_node.items()}


def main() -> None:
    en, cn, tw_old = export_json()
    converter = opencc.OpenCC("s2twp")
    merged = merge(en, cn, tw_old, converter)

    body = json.dumps(merged, ensure_ascii=False, indent=2)
    text = f"""/**
 * Traditional Chinese (Taiwan) UI strings.
 *
 * Generated from zh-CN via OpenCC s2twp, preserving prior zh-TW leaf strings
 * for keys that already existed. Re-run after zh-CN changes:
 *
 *   yarn i18n:sync-zh-TW
 */
export const zhTW = {{
  translation: {body},
}}
"""
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)} ({len(body)} chars)")


if __name__ == "__main__":
    main()
