from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    client = TestClient(app)
    login = client.post("/api/login", json={"password": "test-pass"})
    assert login.status_code == 200
    return client


def test_health_ok(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert response.headers["cache-control"] == "no-store"


def test_index_is_served(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "提词器" in response.text
    assert "text/html" in response.headers["content-type"]
    assert response.headers["cache-control"] == "no-cache"


def test_static_css_is_served(client):
    response = client.get("/style.css")
    assert response.status_code == 200
    assert "text/css" in response.headers["content-type"]
    assert response.headers["cache-control"] == "no-cache"


def test_api_route_is_not_shadowed_by_static_mount(client):
    response = client.get("/api/health")
    assert response.headers["content-type"].startswith("application/json")


def test_scripts_api_and_demo_detail(client):
    response = client.get("/api/scripts")
    assert response.status_code == 200
    assert isinstance(response.json(), list)
    assert response.headers["cache-control"] == "no-store"

    rows = response.json()
    if not rows:
        return
    detail = client.get("/api/scripts/" + quote(rows[0]["id"], safe=""))
    assert detail.status_code == 200
    body = detail.json()
    assert body["paragraphs"]
    assert body["chars"] == sum(p["units"] for p in body["paragraphs"])
