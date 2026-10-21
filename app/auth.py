"""Simple password gate for the LAN deployment.

The app is served over plain HTTP on a campus LAN, so this is a "who knows
the password" gate, not a replacement for HTTPS or a reverse proxy. The
password comes from ``TELEPROMPTER_PASSWORD``; when it is unset we generate
one on first start and keep it in ``data/.access-password`` so restarts do
not change it.
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets
from hashlib import sha256
from pathlib import Path

PASSWORD_ENV = "TELEPROMPTER_PASSWORD"
PASSWORD_FILE = ".access-password"
COOKIE_NAME = "teleprompter_session"
COOKIE_MAX_AGE = 30 * 24 * 60 * 60

# Avoid visually ambiguous characters so the generated password is easy to
# copy from the container log.
ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
TOKEN_MESSAGE = b"teleprompter-session-v1"


class AccessControl:
    """Resolve the password once at startup and validate session cookies."""

    def __init__(self, password: str, *, generated: bool = False) -> None:
        self.password = password
        self.generated = generated
        self.token = hmac.new(
            password.encode("utf-8"), TOKEN_MESSAGE, sha256
        ).hexdigest()

    @classmethod
    def resolve(
        cls, data_dir: Path, log: logging.Logger | None = None
    ) -> "AccessControl":
        log = log or logging.getLogger("teleprompter.auth")
        configured = (os.environ.get(PASSWORD_ENV) or "").strip()
        if configured:
            return cls(configured)

        path = data_dir / PASSWORD_FILE
        try:
            stored = path.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            stored = ""
        except OSError:
            log.exception("无法读取访问密码文件 %s", path)
            stored = ""

        if stored:
            return cls(stored)

        password = "".join(secrets.choice(ALPHABET) for _ in range(8))
        try:
            data_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(password + "\n", encoding="utf-8")
            try:
                path.chmod(0o600)
            except OSError:
                pass
        except OSError:
            log.exception("无法写入访问密码文件 %s", path)

        log.warning(
            "未设置 %s，已生成初始访问密码：%s（也在 %s）",
            PASSWORD_ENV,
            password,
            path,
        )
        return cls(password, generated=True)

    def check(self, candidate: str) -> bool:
        return hmac.compare_digest(
            candidate.encode("utf-8"), self.password.encode("utf-8")
        )

    def is_authenticated(self, cookie: str | None) -> bool:
        return bool(cookie) and hmac.compare_digest(
            cookie.encode("utf-8"), self.token.encode("utf-8")
        )
