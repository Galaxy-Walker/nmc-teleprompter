"""Turn md / txt / docx into clean paragraphs and count reading units.

Deliberately line-based: a speech script wants one paragraph per line, not a
full Markdown document tree. Keep this module dependency-free.
"""

from __future__ import annotations

import html
import io
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"

W_P = f"{{{W}}}p"
W_T = f"{{{W}}}t"
W_TAB = f"{{{W}}}tab"
W_BR = f"{{{W}}}br"
W_CR = f"{{{W}}}cr"
MC_FALLBACK = f"{{{MC}}}Fallback"

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
MAX_DOCX_XML = 20 * 1024 * 1024

_LATIN_RUN = re.compile(r"[A-Za-z0-9]+")
_HEADING = re.compile(r"^#{1,6}\s+")
_QUOTE = re.compile(r"^>+\s?")
_BULLET = re.compile(r"^[-*+]\s+")
_ORDERED = re.compile(r"^\d+\.\s+")
_TASK = re.compile(r"^\[[ xX]\]\s*")
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_REF_LINK = re.compile(r"\[([^\]]+)\]\[[^\]]*\]")
_STRONG = re.compile(r"(\*\*|__)(.*?)\1")
_EMPHASIS = re.compile(r"(\*|_)(.*?)\1")
_HTML_TAG = re.compile(r"<[^>]+>")
_FENCE = re.compile(r"^\s*(```|~~~)")
_HR = re.compile(r"^[-*_]{3,}$")


class ParseError(ValueError):
    """A user-facing parse failure; the API turns this into HTTP 400."""


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def parse_txt(text: str) -> list[str]:
    """Plain text: one non-empty line per paragraph, no Markdown cleanup."""
    return [
        line.strip()
        for line in normalize_newlines(text).split("\n")
        if line.strip()
    ]


def parse_md(text: str) -> list[str]:
    """A deliberately small Markdown cleaner for spoken scripts."""
    paragraphs: list[str] = []
    for raw in normalize_newlines(text).split("\n"):
        line = raw.strip()
        if not line or _FENCE.match(line) or _HR.match(line):
            continue

        line = _HEADING.sub("", line)
        line = _QUOTE.sub("", line)
        line = _BULLET.sub("", line)
        line = _ORDERED.sub("", line)
        line = _TASK.sub("", line)

        line = _IMAGE.sub(r"\1", line)
        line = _LINK.sub(r"\1", line)
        line = _REF_LINK.sub(r"\1", line)
        line = _STRONG.sub(r"\2", line)
        line = _EMPHASIS.sub(r"\2", line)
        line = line.replace("`", "")
        line = _HTML_TAG.sub("", line)
        line = html.unescape(line).strip()

        if line:
            paragraphs.append(line)

    return paragraphs


def decode_text(data: bytes) -> str:
    """Decode md/txt bytes: BOM first, then UTF-8, then GB18030."""
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return data.decode("utf-16")
        except UnicodeDecodeError:
            pass
    if data.startswith(b"\xef\xbb\xbf"):
        try:
            return data.decode("utf-8-sig")
        except UnicodeDecodeError:
            pass

    for encoding in ("utf-8", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue

    raise ParseError("文本编码不支持，请另存为 UTF-8")


def parse_docx(data: bytes) -> list[str]:
    """Read word/document.xml directly, skipping mc:Fallback duplicates."""
    if data.startswith(OLE_MAGIC):
        raise ParseError("旧版 .doc 不支持，请另存为 .docx")
    if not data.startswith(b"PK"):
        raise ParseError("不是有效的 .docx 文件")

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            try:
                info = archive.getinfo("word/document.xml")
            except KeyError:
                raise ParseError("不是有效的 docx：缺少 word/document.xml") from None
            if info.file_size > MAX_DOCX_XML:
                raise ParseError("docx 内容过大")
            xml = archive.read(info)
    except (zipfile.BadZipFile, RuntimeError):
        raise ParseError("不是有效的 .docx 文件") from None

    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        raise ParseError("docx XML 解析失败") from None

    chunks: list[str] = []

    def walk(element):
        if element.tag == MC_FALLBACK:
            return
        if element.tag == W_P:
            chunks.append("\n")
        elif element.tag == W_T:
            chunks.append(element.text or "")
        elif element.tag == W_TAB:
            chunks.append("\t")
        elif element.tag in (W_BR, W_CR):
            chunks.append("\n")
        for child in element:
            walk(child)

    walk(root)
    paragraphs = [
        line.strip()
        for line in "".join(chunks).split("\n")
        if line.strip()
    ]
    if not paragraphs:
        raise ParseError("docx 里没有可读文字")
    return paragraphs


def parse_text_input(text: str) -> list[str]:
    paragraphs = parse_txt(text)
    if not paragraphs:
        raise ParseError("没有可读文字")
    return paragraphs


def parse_upload(filename: str, data: bytes) -> tuple[list[str], str]:
    """Return (paragraphs, source_format); raise ParseError on bad input."""
    suffix = Path(filename or "").suffix.lower()

    if suffix == ".doc":
        raise ParseError("旧版 .doc 不支持，请另存为 .docx")
    if suffix == ".docx":
        return parse_docx(data), "docx"
    if suffix in (".md", ".markdown"):
        paragraphs = parse_md(decode_text(data))
        if not paragraphs:
            raise ParseError("没有可读文字")
        return paragraphs, "md"
    if suffix == ".txt":
        paragraphs = parse_txt(decode_text(data))
        if not paragraphs:
            raise ParseError("没有可读文字")
        return paragraphs, "txt"

    raise ParseError("不支持的文件类型，请上传 .md / .txt / .docx")


def count_units(text: str) -> int:
    """Reading units: whitespace ignored, Latin/digit run = 1, others = 1.

    This is the single source of truth shared by the list and detail APIs;
    the browser only sums the per-paragraph numbers it receives.
    """
    units = 0
    i = 0
    length = len(text)
    while i < length:
        ch = text[i]
        if ch.isspace():
            i += 1
            continue
        if ch.isascii() and ch.isalnum():
            match = _LATIN_RUN.match(text, i)
            if match:
                units += 1
                i = match.end()
                continue
        units += 1
        i += 1
    return units


def paragraphs_with_units(paragraphs: list[str]) -> list[dict[str, object]]:
    return [{"text": p, "units": count_units(p)} for p in paragraphs]
