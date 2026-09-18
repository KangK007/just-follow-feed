"""Move a legacy Bilibili cookie out of the tracked sidecar config."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import yaml


MAX_COOKIE_BYTES = 64 * 1024


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def protect_secret_file(path: Path) -> None:
    if os.name != "nt":
        path.chmod(0o600)
        return
    identity = subprocess.run(
        ["whoami.exe"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    subprocess.run(
        [
            "icacls.exe",
            str(path),
            "/inheritance:r",
            "/grant:r",
            f"{identity}:(F)",
            "*S-1-5-18:(F)",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sidecar-root", type=Path, required=True)
    parser.add_argument("--cookie-file", type=Path, required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--entry", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()

    sidecar_root = args.sidecar_root.resolve()
    config_path = sidecar_root / "crawlers" / "bilibili" / "web" / "config.yaml"
    content = config_path.read_text(encoding="utf-8")
    config = yaml.safe_load(content)
    cookie = config["TokenManager"]["bilibili"]["headers"].get("cookie", "")
    if not isinstance(cookie, str):
        raise TypeError("Legacy Bilibili Cookie must be text")
    if not cookie:
        print("No legacy Bilibili Cookie needs migration.")
        return
    if len(cookie.encode("utf-8")) > MAX_COOKIE_BYTES or "\r" in cookie or "\n" in cookie:
        raise ValueError("Legacy Bilibili Cookie is not a valid single-line value")

    cookie_file = args.cookie_file.resolve()
    if cookie_file.exists():
        existing = cookie_file.read_text(encoding="utf-8").strip()
        if existing != cookie:
            raise RuntimeError("External Bilibili Cookie file already contains a different value")
    else:
        atomic_write(cookie_file, cookie)
    protect_secret_file(cookie_file)

    subprocess.run(
        [
            sys.executable,
            str(args.entry.resolve()),
            "--sidecar-root",
            str(sidecar_root),
            "--cookie-file",
            str(cookie_file),
            "--token-file",
            str(args.token_file.resolve()),
            "--port",
            str(args.port),
            "--check",
        ],
        check=True,
    )

    pattern = re.compile(r"(?mi)^(\s*)(['\"]?cookie['\"]?)\s*:.*$")
    if len(pattern.findall(content)) != 1:
        raise RuntimeError("Could not identify one Bilibili Cookie setting to clear")
    sanitized = pattern.sub(lambda match: f"{match.group(1)}{match.group(2)}: ''", content, count=1)
    atomic_write(config_path, sanitized)
    print("Legacy Bilibili Cookie migrated to the external local file.")


if __name__ == "__main__":
    main()
