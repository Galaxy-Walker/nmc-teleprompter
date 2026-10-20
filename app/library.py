"""Filesystem-backed script library.

One directory per script: source file, clean text, meta. The demo is seeded
only once (marker file), so deleting it in the UI does not resurrect it on the
next start.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from app.parse import (
    ParseError,
    count_units,
    parse_md,
    parse_text_input,
    parse_upload,
)

log = logging.getLogger("teleprompter.library")

ID_RE = re.compile(r"^[\w-]{1,80}$")
DEMO_TITLE = "示例：把复杂的事做简单"
DEMO_MARKER = ".demo-seeded"
MAX_TITLE = 80


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _valid_id(script_id: str) -> bool:
    return bool(ID_RE.fullmatch(script_id))


def _script_dir(scripts_dir: Path, script_id: str) -> Path:
    if not _valid_id(script_id):
        raise FileNotFoundError(script_id)
    root = scripts_dir.resolve()
    path = (root / script_id).resolve()
    if not path.is_relative_to(root):
        raise FileNotFoundError(script_id)
    return path


def _clean_title(value: str | None, fallback: str = "未命名") -> str:
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", value or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:MAX_TITLE] or fallback


def _slug(title: str) -> str:
    text = re.sub(r"[^\w-]+", "-", title, flags=re.UNICODE).strip("-")
    return text[:40] or "未命名"


def _atomic_write(path: Path, data: bytes | str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    if isinstance(data, bytes):
        tmp.write_bytes(data)
    else:
        tmp.write_text(data, encoding="utf-8")
    os.replace(tmp, path)


def _create_dir(scripts_dir: Path, title: str) -> tuple[str, Path]:
    scripts_dir.mkdir(parents=True, exist_ok=True)
    date = datetime.now().strftime("%Y-%m-%d")
    base = f"{date}_{_slug(title)}"

    for index in range(1, 100):
        script_id = base if index == 1 else f"{base}-{index}"
        path = scripts_dir / script_id
        try:
            path.mkdir(parents=False, exist_ok=False)
            return script_id, path
        except FileExistsError:
            continue

    raise RuntimeError("无法创建稿件目录")


def _create(
    scripts_dir: Path,
    *,
    title: str,
    paragraphs: list[str],
    source_bytes: bytes,
    source_ext: str,
    source_name: str | None,
    source_format: str,
) -> dict[str, object]:
    chars = sum(count_units(paragraph) for paragraph in paragraphs)
    script_id, path = _create_dir(scripts_dir, title)
    now = _now()
    meta = {
        "schema": 1,
        "title": title,
        "chars": chars,
        "source_name": source_name,
        "source_format": source_format,
        "created_at": now,
        "updated_at": now,
    }

    try:
        _atomic_write(path / f"source{source_ext}", source_bytes)
        _atomic_write(path / "text.txt", "\n".join(paragraphs) + "\n")
        _atomic_write(
            path / "meta.json",
            json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        )
    except Exception:
        shutil.rmtree(path, ignore_errors=True)
        raise

    return {"id": script_id, "title": title, "chars": chars}


def create_from_upload(
    scripts_dir: Path,
    filename: str,
    data: bytes,
    title: str | None = None,
) -> dict[str, object]:
    paragraphs, source_format = parse_upload(filename, data)
    source_name = Path(filename).name or "upload"
    default_title = Path(filename).stem or "未命名"
    final_title = _clean_title(title, "") or _clean_title(default_title)
    source_ext = Path(filename).suffix.lower()

    return _create(
        scripts_dir,
        title=final_title,
        paragraphs=paragraphs,
        source_bytes=data,
        source_ext=source_ext,
        source_name=source_name,
        source_format=source_format,
    )


def create_from_text(
    scripts_dir: Path,
    text: str,
    title: str | None = None,
) -> dict[str, object]:
    paragraphs = parse_text_input(text)
    default_title = paragraphs[0][:20]
    final_title = _clean_title(title, "") or _clean_title(default_title)

    return _create(
        scripts_dir,
        title=final_title,
        paragraphs=paragraphs,
        source_bytes=text.encode("utf-8"),
        source_ext=".txt",
        source_name=None,
        source_format="txt",
    )


def update_script(
    scripts_dir: Path,
    script_id: str,
    *,
    title: str | None = None,
    text: str | None = None,
) -> dict[str, object]:
    if title is None and text is None:
        raise ParseError("没有要修改的内容")

    path = _script_dir(scripts_dir, script_id)
    meta_path = path / "meta.json"
    if not meta_path.is_file():
        raise FileNotFoundError(script_id)

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except ValueError:
        raise FileNotFoundError(script_id) from None
    if not isinstance(meta, dict):
        raise FileNotFoundError(script_id)

    if title is not None:
        new_title = _clean_title(title, "")
        if not new_title:
            raise ParseError("标题不能为空")
        meta["title"] = new_title

    if text is not None:
        paragraphs = parse_text_input(text)
        chars = sum(count_units(paragraph) for paragraph in paragraphs)
        _atomic_write(path / "text.txt", "\n".join(paragraphs) + "\n")
        meta["chars"] = chars

    meta["updated_at"] = _now()
    _atomic_write(
        meta_path,
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
    )

    return {
        "id": script_id,
        "title": str(meta.get("title") or script_id),
        "chars": int(meta.get("chars") or 0),
        "updated_at": str(meta.get("updated_at") or ""),
    }


def delete_script(scripts_dir: Path, script_id: str) -> None:
    path = _script_dir(scripts_dir, script_id)
    if not path.is_dir():
        raise FileNotFoundError(script_id)
    shutil.rmtree(path)


def list_scripts(scripts_dir: Path) -> list[dict[str, object]]:
    """Return list rows, newest first. Corrupt entries are skipped, not fatal."""
    if not scripts_dir.exists():
        return []

    rows: list[dict[str, object]] = []
    for path in scripts_dir.iterdir():
        if not path.is_dir():
            continue
        try:
            meta = json.loads((path / "meta.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            log.warning("skip unreadable script dir: %s", path.name)
            continue
        if not isinstance(meta, dict):
            continue
        try:
            chars = int(meta.get("chars") or 0)
        except (TypeError, ValueError):
            chars = 0
        rows.append(
            {
                "id": path.name,
                "title": str(meta.get("title") or path.name),
                "chars": chars,
                "updated_at": str(meta.get("updated_at") or ""),
            }
        )

    rows.sort(key=lambda row: str(row["updated_at"]), reverse=True)
    return rows


def get_script(scripts_dir: Path, script_id: str) -> dict[str, object]:
    """Return one script with per-paragraph units. Raises FileNotFoundError."""
    path = _script_dir(scripts_dir, script_id)
    meta_path = path / "meta.json"
    if not meta_path.is_file():
        raise FileNotFoundError(script_id)

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except ValueError:
        raise FileNotFoundError(script_id) from None
    if not isinstance(meta, dict):
        raise FileNotFoundError(script_id)

    text = (path / "text.txt").read_text(encoding="utf-8")
    paragraphs = [line.strip() for line in text.splitlines() if line.strip()]
    items = [
        {"text": paragraph, "units": count_units(paragraph)}
        for paragraph in paragraphs
    ]

    return {
        "id": script_id,
        "title": str(meta.get("title") or script_id),
        "chars": sum(int(item["units"]) for item in items),
        "updated_at": str(meta.get("updated_at") or ""),
        "paragraphs": items,
    }


def ensure_demo(scripts_dir: Path, sample_path: Path) -> None:
    """Seed one sample script on first run only; never overwrite or reseed."""
    scripts_dir.mkdir(parents=True, exist_ok=True)
    marker = scripts_dir / DEMO_MARKER
    if marker.exists():
        return

    has_scripts = any(
        (path / "meta.json").exists()
        for path in scripts_dir.iterdir()
        if path.is_dir()
    )
    if has_scripts or not sample_path.is_file():
        marker.write_text(_now() + "\n", encoding="utf-8")
        return

    source = sample_path.read_text(encoding="utf-8")
    paragraphs = parse_md(source)
    if not paragraphs:
        marker.write_text(_now() + "\n", encoding="utf-8")
        return

    _create(
        scripts_dir,
        title=DEMO_TITLE,
        paragraphs=paragraphs,
        source_bytes=source.encode("utf-8"),
        source_ext=".md",
        source_name=sample_path.name,
        source_format="md",
    )
    marker.write_text(_now() + "\n", encoding="utf-8")
