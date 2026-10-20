from pathlib import Path

import pytest

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

SAMPLE = "# 标题\n\n第一段。\n\n第二段有 hello world。\n"


def test_seed_list_and_read(tmp_path: Path):
    sample = tmp_path / "sample.md"
    sample.write_text(SAMPLE, encoding="utf-8")
    scripts = tmp_path / "scripts"

    ensure_demo(scripts, sample)
    rows = list_scripts(scripts)
    assert len(rows) == 1
    assert rows[0]["title"].startswith("示例")

    detail = get_script(scripts, str(rows[0]["id"]))
    assert [p["text"] for p in detail["paragraphs"]] == [
        "标题",
        "第一段。",
        "第二段有 hello world。",
    ]
    assert detail["chars"] == sum(p["units"] for p in detail["paragraphs"])
    assert detail["chars"] > 0


def test_seed_is_idempotent(tmp_path: Path):
    sample = tmp_path / "sample.md"
    sample.write_text(SAMPLE, encoding="utf-8")
    scripts = tmp_path / "scripts"

    ensure_demo(scripts, sample)
    ensure_demo(scripts, sample)
    assert len(list_scripts(scripts)) == 1


def test_demo_is_not_reseeded_after_delete(tmp_path: Path):
    sample = tmp_path / "sample.md"
    sample.write_text(SAMPLE, encoding="utf-8")
    scripts = tmp_path / "scripts"

    ensure_demo(scripts, sample)
    rows = list_scripts(scripts)
    delete_script(scripts, str(rows[0]["id"]))
    ensure_demo(scripts, sample)
    assert list_scripts(scripts) == []


def test_create_from_text_and_collision(tmp_path: Path):
    scripts = tmp_path / "scripts"

    first = create_from_text(scripts, "第一段\n第二段", "同名")
    second = create_from_text(scripts, "另一段", "同名")
    assert first["id"] != second["id"]
    assert first["title"] == "同名"

    rows = list_scripts(scripts)
    assert len(rows) == 2
    detail = get_script(scripts, str(first["id"]))
    assert [p["text"] for p in detail["paragraphs"]] == ["第一段", "第二段"]


def test_create_from_upload_md(tmp_path: Path):
    scripts = tmp_path / "scripts"
    result = create_from_upload(
        scripts,
        "稿件.md",
        "# 标题\n\n你好 world。".encode("utf-8"),
    )
    assert result["title"] == "稿件"
    detail = get_script(scripts, str(result["id"]))
    assert [p["text"] for p in detail["paragraphs"]] == ["标题", "你好 world。"]
    assert (scripts / str(result["id"]) / "source.md").is_file()


def test_update_rename_and_text(tmp_path: Path):
    scripts = tmp_path / "scripts"
    result = create_from_text(scripts, "第一段\n第二段", "原标题")
    script_id = str(result["id"])

    update_script(scripts, script_id, title="新标题")
    assert get_script(scripts, script_id)["title"] == "新标题"

    update_script(scripts, script_id, text="更新一\n更新二")
    detail = get_script(scripts, script_id)
    assert [p["text"] for p in detail["paragraphs"]] == ["更新一", "更新二"]
    assert detail["chars"] == sum(p["units"] for p in detail["paragraphs"])


def test_delete_script(tmp_path: Path):
    scripts = tmp_path / "scripts"
    result = create_from_text(scripts, "要删除的内容", "删除")
    script_id = str(result["id"])

    delete_script(scripts, script_id)
    assert list_scripts(scripts) == []
    with pytest.raises(FileNotFoundError):
        get_script(scripts, script_id)
    with pytest.raises(FileNotFoundError):
        delete_script(scripts, script_id)


def test_rejects_empty_text_and_empty_title(tmp_path: Path):
    scripts = tmp_path / "scripts"

    with pytest.raises(ParseError):
        create_from_text(scripts, " \n \n ")

    result = create_from_text(scripts, "正文", "标题")
    with pytest.raises(ParseError):
        update_script(scripts, str(result["id"]), title="   ")


def test_rejects_old_doc(tmp_path: Path):
    scripts = tmp_path / "scripts"
    with pytest.raises(ParseError):
        create_from_upload(scripts, "旧稿.doc", b"\xd0\xcf\x11\xe0")


def test_missing_and_path_traversal(tmp_path: Path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()

    with pytest.raises(FileNotFoundError):
        get_script(scripts, "nope")
    with pytest.raises(FileNotFoundError):
        get_script(scripts, "..")
    with pytest.raises(FileNotFoundError):
        update_script(scripts, "..", title="x")
    with pytest.raises(FileNotFoundError):
        delete_script(scripts, "..")
