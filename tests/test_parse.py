import pytest

from app.parse import (
    ParseError,
    count_units,
    decode_text,
    parse_docx,
    parse_md,
    parse_text_input,
    parse_txt,
    parse_upload,
)


def test_count_units_mixed_language():
    assert count_units("你好，世界。") == 6
    assert count_units("hello world 2026") == 3
    assert count_units("第 1 章") == 3
    assert count_units("") == 0


def test_parse_md_cleans_markup():
    text = """# 标题
> 引用
- 项目
1. 有序
[链接](https://example.com) 和 ![图](x.png)
**重点** 和 `代码`
<span>HTML</span>
---
```
围栏
```
"""
    rows = parse_md(text)
    assert "标题" in rows
    assert "引用" in rows
    assert "项目" in rows
    assert "有序" in rows
    assert "链接 和 图" in rows
    assert "重点 和 代码" in rows
    assert "HTML" in rows
    assert "围栏" in rows
    assert "---" not in rows
    assert "```" not in rows


def test_parse_txt_normalizes_newlines():
    assert parse_txt(" a \r\n\r\n b \r") == ["a", "b"]


def test_parse_docx_textbox_once(docx_bytes):
    rows = parse_docx(docx_bytes)
    assert rows == ["第一段", "文本框内容", "第三段"]
    assert "".join(rows).count("文本框内容") == 1


def test_parse_docx_rejects_old_doc():
    with pytest.raises(ParseError):
        parse_docx(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"x" * 8)


def test_parse_docx_rejects_non_zip():
    with pytest.raises(ParseError):
        parse_docx(b"definitely not a zip")


def test_parse_docx_requires_document_xml(docx_missing_document_bytes):
    with pytest.raises(ParseError):
        parse_docx(docx_missing_document_bytes)


def test_decode_text_encodings():
    text = "你好，世界"
    assert decode_text(text.encode("utf-8")) == text
    assert decode_text(text.encode("utf-8-sig")) == text
    assert decode_text(text.encode("utf-16")) == text
    assert decode_text(text.encode("gb18030")) == text


def test_parse_upload_dispatch(docx_bytes):
    rows, fmt = parse_upload("稿件.md", "# 标题\n\n你好".encode("utf-8"))
    assert (rows, fmt) == (["标题", "你好"], "md")

    rows, fmt = parse_upload("稿件.txt", "第一行\r\n第二行".encode("utf-8"))
    assert (rows, fmt) == (["第一行", "第二行"], "txt")

    rows, fmt = parse_upload("稿件.docx", docx_bytes)
    assert fmt == "docx"
    assert rows == ["第一段", "文本框内容", "第三段"]


def test_parse_upload_rejects_bad_types():
    with pytest.raises(ParseError):
        parse_upload("旧稿.doc", b"\xd0\xcf\x11\xe0")
    with pytest.raises(ParseError):
        parse_upload("稿件.pdf", b"%PDF-1.7")


def test_parse_text_input_empty():
    with pytest.raises(ParseError):
        parse_text_input(" \n \n ")
