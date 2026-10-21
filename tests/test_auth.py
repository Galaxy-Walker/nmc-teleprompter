import pytest
from fastapi.testclient import TestClient

from app import main as app_main
from app.auth import AccessControl
from app.main import app


@pytest.fixture
def client():
    return TestClient(app, follow_redirects=False)


def test_health_stays_public(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_root_redirects_to_login(client):
    response = client.get("/")
    assert response.status_code == 303
    assert response.headers["location"] == "/login"

    page = client.get("/login")
    assert page.status_code == 200
    assert "访问密码" in page.text
    assert page.headers["cache-control"] == "no-store"


def test_api_and_static_require_password(client):
    api = client.get("/api/scripts")
    assert api.status_code == 401
    assert api.json() == {"detail": "需要密码"}

    css = client.get("/style.css")
    assert css.status_code == 303
    assert css.headers["location"].startswith("/login?next=")


def test_wrong_password_is_rejected(client):
    response = client.post("/api/login", json={"password": "nope"})
    assert response.status_code == 401
    assert response.json() == {"detail": "密码不正确"}
    assert "teleprompter_session=" not in response.headers.get("set-cookie", "")


def test_login_sets_session_and_logout_clears_it(client):
    response = client.post("/api/login", json={"password": "test-pass"})
    assert response.status_code == 200
    assert response.json() == {"ok": True}

    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Path=/" in cookie
    assert "Max-Age=2592000" in cookie

    assert client.get("/api/scripts").status_code == 200
    assert client.get("/").status_code == 200

    logout = client.post("/api/logout")
    assert logout.status_code == 200
    assert client.get("/api/scripts").status_code == 401


def test_authenticated_visit_to_login_redirects(client):
    client.post("/api/login", json={"password": "test-pass"})

    root = client.get("/login")
    assert root.status_code == 303
    assert root.headers["location"] == "/"

    safe = client.get("/login?next=/style.css")
    assert safe.status_code == 303
    assert safe.headers["location"] == "/style.css"


def test_login_next_rejects_external_redirects(client):
    client.post("/api/login", json={"password": "test-pass"})

    for target in ("https://evil.example/", "//evil.example/", "/\\evil.example"):
        response = client.get("/login?next=" + target)
        assert response.status_code == 303
        assert response.headers["location"] == "/"


def test_password_change_invalidates_old_cookie(client, monkeypatch):
    assert client.post("/api/login", json={"password": "test-pass"}).status_code == 200
    assert client.get("/api/scripts").status_code == 200

    monkeypatch.setattr(app_main, "ACCESS", AccessControl("new-pass"))

    assert client.get("/api/scripts").status_code == 401
    assert client.post("/api/login", json={"password": "test-pass"}).status_code == 401
    assert client.post("/api/login", json={"password": "new-pass"}).status_code == 200
    assert client.get("/api/scripts").status_code == 200


def test_unicode_password_works(client, monkeypatch):
    monkeypatch.setattr(app_main, "ACCESS", AccessControl("中文密码"))

    wrong = client.post("/api/login", json={"password": "中文"})
    assert wrong.status_code == 401

    right = client.post("/api/login", json={"password": "中文密码"})
    assert right.status_code == 200


def test_generated_password_is_persisted(tmp_path, monkeypatch):
    monkeypatch.delenv("TELEPROMPTER_PASSWORD", raising=False)

    first = AccessControl.resolve(tmp_path)
    assert first.generated
    assert len(first.password) == 8
    password_file = tmp_path / ".access-password"
    assert password_file.read_text(encoding="utf-8").strip() == first.password

    second = AccessControl.resolve(tmp_path)
    assert not second.generated
    assert second.password == first.password
    assert second.token == first.token


def test_environment_password_wins(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEPROMPTER_PASSWORD", "from-env")

    access = AccessControl.resolve(tmp_path)
    assert access.password == "from-env"
    assert not access.generated
    assert not (tmp_path / ".access-password").exists()

