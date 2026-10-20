"""FastAPI entry point: health, scripts API, static hosting.

P2 scope: upload (md/docx/txt), paste, rename, delete. The browser is a
no-build ES module app; this module stays the single wiring point.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.library import (
    create_from_text,
    create_from_upload,
    delete_script,
    ensure_demo,
    get_script,
    list_scripts,
    update_script,
)
from app.parse import ParseError

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data")).resolve()
SCRIPTS_DIR = DATA_DIR / "scripts"
MAX_UPLOAD = 10 * 1024 * 1024

# Fail fast if the process cannot even prepare its data directory.
DATA_DIR.mkdir(parents=True, exist_ok=True)
SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

log = logging.getLogger("teleprompter")
try:
    ensure_demo(SCRIPTS_DIR, BASE_DIR / "samples" / "long.md")
except Exception:  # a bad sample must not stop the health endpoint
    log.exception("failed to seed demo script")

app = FastAPI(title="Teleprompter", version="0.2.0")


class ScriptPatch(BaseModel):
    title: str | None = None
    text: str | None = None


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/scripts")
def scripts() -> list[dict[str, object]]:
    return list_scripts(SCRIPTS_DIR)


@app.post("/api/scripts", status_code=201)
def create_script(
    file: UploadFile | None = File(default=None),
    text: str | None = Form(default=None),
    title: str | None = Form(default=None),
) -> dict[str, object]:
    if (file is None) == (text is None):
        raise HTTPException(status_code=400, detail="file 和 text 必须二选一")

    try:
        if file is not None:
            data = file.file.read(MAX_UPLOAD + 1)
            if len(data) > MAX_UPLOAD:
                raise HTTPException(status_code=413, detail="文件超过 10MB")
            return create_from_upload(
                SCRIPTS_DIR,
                file.filename or "upload",
                data,
                title,
            )

        raw = text or ""
        if len(raw.encode("utf-8")) > MAX_UPLOAD:
            raise HTTPException(status_code=413, detail="文本超过 10MB")
        return create_from_text(SCRIPTS_DIR, raw, title)
    except ParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@app.get("/api/scripts/{script_id}")
def script_detail(script_id: str) -> dict[str, object]:
    try:
        return get_script(SCRIPTS_DIR, script_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="稿件不存在") from None


@app.patch("/api/scripts/{script_id}")
def patch_script(script_id: str, patch: ScriptPatch) -> dict[str, object]:
    if patch.title is None and patch.text is None:
        raise HTTPException(status_code=400, detail="没有要修改的内容")

    try:
        return update_script(
            SCRIPTS_DIR,
            script_id,
            title=patch.title,
            text=patch.text,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="稿件不存在") from None
    except ParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@app.delete("/api/scripts/{script_id}", status_code=204)
def remove_script(script_id: str) -> None:
    try:
        delete_script(SCRIPTS_DIR, script_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="稿件不存在") from None
    return None


@app.middleware("http")
async def cache_control(request: Request, call_next):
    """Keep the frontend fresh after an overwrite, and API responses uncached."""
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    else:
        response.headers["Cache-Control"] = "no-cache"
    return response


# Mount last: API routes above always win over the catch-all static mount.
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
