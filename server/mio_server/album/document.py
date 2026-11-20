"""Locate the explicit HTML document shell without reserializing template content."""

from __future__ import annotations

import re
from dataclasses import dataclass
from html.parser import HTMLParser

_SHELL = (
    ("html", True),
    ("head", True),
    ("head", False),
    ("body", True),
    ("body", False),
    ("html", False),
)
_DOCUMENT_TAGS = {"html", "head", "body"}
_HTML_SPACE = " \t\n\r\f"
_HEAD_TEXT = {"noscript", "style", "title"}
_HEAD_TAGS = {"base", "link", "meta"} | _HEAD_TEXT


@dataclass(frozen=True)
class DocumentShell:
    head_start: int
    head_end: int
    body_start: int
    body_end: int
    has_doctype: bool


class _DocumentParser(HTMLParser):
    # Python 3.11 handles only script and style as raw text by default.
    CDATA_CONTENT_ELEMENTS = (
        "script",
        "style",
        "title",
        "textarea",
        "iframe",
        "xmp",
        "noembed",
        "noframes",
        "noscript",
    )

    def __init__(self, source: str):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.line_offsets = [0, *(match.end() for match in re.finditer("\n", source))]
        self.boundaries: list[int] = []
        self.head_text: str | None = None
        self.template_depth = 0
        self.has_doctype = False

    def source_offset(self) -> int:
        line, column = self.getpos()
        return self.line_offsets[line - 1] + column

    def invalid(self) -> None:
        raise ValueError("模板必须按顺序包含完整的 <html>、<head> 和 <body> 标签")

    def shell_tag(self, tag: str, opening: bool, offset: int) -> None:
        step = len(self.boundaries)
        if step == len(_SHELL) or _SHELL[step] != (tag, opening):
            self.invalid()
        self.boundaries.append(offset)

    def handle_starttag(self, tag, attrs):
        if tag == "meta" and any(
            name == "http-equiv" and (value or "").strip().lower() == "refresh"
            for name, value in attrs
        ):
            raise ValueError("离线画册模板不能自动跳转（meta refresh）")
        step = len(self.boundaries)
        if tag in _DOCUMENT_TAGS:
            start = self.get_starttag_text()
            if "{{" in start or self.head_text or self.template_depth:
                self.invalid()
            self.shell_tag(tag, True, self.source_offset() + len(start))
        elif step == 2:
            if self.head_text or tag not in _HEAD_TAGS:
                self.invalid()
            if tag in _HEAD_TEXT:
                self.head_text = tag
        elif step == 4:
            if tag == "plaintext":
                self.invalid()  # Everything after this tag is text in an HTML document.
            if tag == "template":
                self.template_depth += 1
        else:
            self.invalid()

    def handle_startendtag(self, tag, attrs):
        # A slash does not close a non-void HTML element, including a shell tag.
        if tag in _DOCUMENT_TAGS or tag == "template" or tag in self.CDATA_CONTENT_ELEMENTS:
            self.invalid()
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        step = len(self.boundaries)
        if tag in _DOCUMENT_TAGS:
            if self.head_text or self.template_depth:
                self.invalid()
            self.shell_tag(tag, False, self.source_offset())
        elif step == 2 and tag == self.head_text:
            self.head_text = None
        elif step == 4:
            if tag == "template" and self.template_depth:
                self.template_depth -= 1
        else:
            self.invalid()

    def handle_data(self, data):
        if self.head_text == "noscript" or self.cdata_elem == "noscript":
            if re.search(r"<\s*meta\b", data, flags=re.I):
                raise ValueError("离线画册 noscript 不能包含 meta 标签")
        if len(self.boundaries) == 4 or self.head_text:
            return
        if self.source_offset() == 0:
            data = data.removeprefix("\ufeff")
        if data.strip(_HTML_SPACE):
            self.invalid()

    def handle_entityref(self, name):
        self.handle_data("&")

    def handle_charref(self, name):
        self.handle_data("&")

    def handle_decl(self, decl):
        if (
            self.boundaries
            or self.has_doctype
            or not re.fullmatch(r"doctype[ \t\r\n\f]+html[ \t\r\n\f]*", decl, flags=re.I)
        ):
            self.invalid()
        self.has_doctype = True

    def handle_comment(self, data):
        # Recognize ordinary comments in the shell using the same boundaries as the browser.
        if (
            not self.source.startswith(f"<!--{data}-->", self.source_offset())
            or data.startswith((">", "->"))
            or "--!>" in data
            or "<!--" in data
        ):
            self.invalid()

    def handle_pi(self, data):
        self.invalid()

    def unknown_decl(self, data):
        self.invalid()


def document_shell(source: str) -> DocumentShell:
    parser = _DocumentParser(source)
    parser.feed(source)
    parser.close()
    if len(parser.boundaries) != len(_SHELL):
        parser.invalid()
    _, head_start, head_end, body_start, body_end, _ = parser.boundaries
    books_start, books_end = source.find("{{#books}}"), source.find("{{/books}}")
    if not body_start <= books_start < books_end < body_end:
        raise ValueError("books 循环必须位于 <body> 中")
    return DocumentShell(head_start, head_end, body_start, body_end, parser.has_doctype)
