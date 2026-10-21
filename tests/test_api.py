from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from app import main as app_main
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    monkeypatch.setattr(app_main, "SCRIPTS_DIR", scripts)
    client = TestClient(app)
    login = client.post("/api/login", json={"password": "test-pass"})
    assert login.status_code == 200
    return client


def _url(script_id: str) -> str:
    return "/api/scripts/" + quote(script_id, safe="")


def test_text_create_list_patch_delete(client):
    response = client.post(
        "/api/scripts",
        data={"text": "第一段\n第二段", "title": "测试"},
    )
    assert response.status_code == 201
    body = response.json()
    script_id = body["id"]
    assert body["title"] == "测试"
    assert body["chars"] > 0

    rows = client.get("/api/scripts").json()
    assert len(rows) == 1
    assert rows[0]["id"] == script_id

    detail = client.get(_url(script_id)).json()
    assert [p["text"] for p in detail["paragraphs"]] == ["第一段", "第二段"]

    renamed = client.patch(_url(script_id), json={"title": "新标题"})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "新标题"

    assert client.delete(_url(script_id)).status_code == 204
    assert client.get(_url(script_id)).status_code == 404
    assert client.get("/api/scripts").json() == []


def test_upload_markdown(client):
    response = client.post(
        "/api/scripts",
        files={"file": ("稿件.md", "# 标题\n\n你好 world。".encode("utf-8"), "text/markdown")},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "稿件"

    detail = client.get(_url(body["id"])).json()
    assert [p["text"] for p in detail["paragraphs"]] == ["标题", "你好 world。"]


def test_upload_docx_textbox_once(client, docx_bytes):
    response = client.post(
        "/api/scripts",
        files={
            "file": (
                "带文本框.docx",
                docx_bytes,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert response.status_code == 201
    detail = client.get(_url(response.json()["id"])).json()
    texts = [p["text"] for p in detail["paragraphs"]]
    assert texts == ["第一段", "文本框内容", "第三段"]
    assert "".join(texts).count("文本框内容") == 1


def test_create_validation(client, docx_bytes):
    both = client.post(
        "/api/scripts",
        files={"file": ("a.md", b"# x", "text/markdown")},
        data={"text": "y"},
    )
    assert both.status_code == 400

    neither = client.post("/api/scripts")
    assert neither.status_code == 400

    empty = client.post("/api/scripts", data={"text": " \n "})
    assert empty.status_code == 400

    old_doc = client.post(
        "/api/scripts",
        files={"file": ("旧稿.doc", b"\xd0\xcf\x11\xe0", "application/msword")},
    )
    assert old_doc.status_code == 400

    pdf = client.post(
        "/api/scripts",
        files={"file": ("稿.pdf", b"%PDF-1.7", "application/pdf")},
    )
    assert pdf.status_code == 400


def test_missing_script_routes(client):
    assert client.patch("/api/scripts/nope", json={"title": "x"}).status_code == 404
    assert client.delete("/api/scripts/nope").status_code == 404
