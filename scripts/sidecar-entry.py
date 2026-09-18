"""Start the pinned local sidecar without persisting the Bilibili cookie in it."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import sys


MAX_COOKIE_BYTES = 64 * 1024
MAX_TOKEN_BYTES = 4 * 1024


def read_cookie(path: Path) -> str:
    if not path.is_file():
        return ""
    if path.stat().st_size > MAX_COOKIE_BYTES:
        raise ValueError("Bilibili Cookie file must not exceed 64 KB")
    value = path.read_text(encoding="utf-8").strip()
    if "\r" in value or "\n" in value:
        raise ValueError("Bilibili Cookie file must contain one line")
    return value


def read_token(path: Path) -> str:
    if not path.is_file() or path.stat().st_size > MAX_TOKEN_BYTES:
        raise ValueError("Sidecar token file is missing or too large")
    value = path.read_text(encoding="utf-8").strip()
    if len(value) < 32 or "\r" in value or "\n" in value:
        raise ValueError("Sidecar token must be a single line with at least 32 characters")
    return value


class BearerAuthMiddleware:
    """Require the local bearer token for every endpoint except health discovery."""

    def __init__(self, app: object, token: str) -> None:
        self.app = app
        self.authorization = f"Bearer {token}".encode("ascii")

    async def __call__(self, scope: dict, receive: object, send: object) -> None:
        if scope.get("type") != "http" or scope.get("path") == "/openapi.json":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        if secrets.compare_digest(headers.get(b"authorization", b""), self.authorization):
            await self.app(scope, receive, send)
            return
        body = json.dumps({"detail": "Unauthorized"}).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"www-authenticate", b"Bearer"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sidecar-root", type=Path, required=True)
    parser.add_argument("--cookie-file", type=Path, required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    sidecar_root = args.sidecar_root.resolve()
    if not (sidecar_root / "app" / "main.py").is_file():
        raise FileNotFoundError(f"Invalid sidecar directory: {sidecar_root}")
    if not 0 < args.port < 65_536:
        raise ValueError("Sidecar port must be between 1 and 65535")

    cookie = read_cookie(args.cookie_file.resolve())
    token = read_token(args.token_file.resolve())
    sys.path.insert(0, str(sidecar_root))
    os.chdir(sidecar_root)

    from app.main import app as sidecar_app  # pylint: disable=import-outside-toplevel
    from crawlers.bilibili.web import web_crawler  # pylint: disable=import-outside-toplevel
    import uvicorn  # pylint: disable=import-outside-toplevel

    try:
        headers = web_crawler.config["TokenManager"]["bilibili"]["headers"]
    except (KeyError, TypeError) as error:
        raise RuntimeError("Pinned sidecar has an incompatible Bilibili config") from error
    headers["cookie"] = cookie
    app = BearerAuthMiddleware(sidecar_app, token)

    if args.check:
        if headers["cookie"] != cookie:
            raise RuntimeError("Bilibili Cookie override check failed")
        print("Sidecar entry check passed.")
        return

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
