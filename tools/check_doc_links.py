"""Check tracked Markdown/HTML paths and fragments without network or application imports.

Run with no paths for the repository, or name specific documents/directories. Fenced code,
inline code, external URLs and explicit template URLs are reported separately. Missing
links in historical reports and committed build output still fail the check.
"""

from __future__ import annotations

import argparse
import ast
import html
import json
import re
import subprocess
import sys
import tempfile
import unicodedata
from collections import Counter
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

DOCUMENT_SUFFIXES = {".md", ".html", ".htm"}


@dataclass(frozen=True)
class Link:
    target: str
    line: int


class HtmlLinks(HTMLParser):
    def __init__(self, text: str):
        super().__init__(convert_charrefs=True)
        self.links: list[Link] = []
        self.ids: set[str] = set()
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag == "a" and attrs.get("name"):
            self.ids.add(attrs["name"])
        for key in ("href", "src", "poster"):
            if attrs.get(key):
                self.links.append(Link(attrs[key], self.getpos()[0]))

    handle_startendtag = handle_starttag


def prose(text: str, *, mask_inline: bool = True) -> str:
    """Mask examples while retaining line numbers and real inline HTML."""
    lines, fence = [], None
    for line in text.splitlines(keepends=True):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if marker:
            token = marker[1]
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            lines.append("\n" if line.endswith("\n") else "")
        elif fence is not None:
            lines.append("\n" if line.endswith("\n") else "")
        else:
            lines.append(line)
    text = "".join(lines)
    text = re.sub(r"<!--.*?-->", lambda m: "\n" * m[0].count("\n"), text, flags=re.S)
    return (
        re.sub(r"(`+)([^`]|(?!\1)`)*?\1", lambda m: " " * len(m[0]), text) if mask_inline else text
    )


def markdown_links(text: str) -> list[Link]:
    clean = prose(text)
    links, spans = [], []
    definitions = {}
    for match in re.finditer(r"^ {0,3}\[([^]\n]+)\]:\s*(<[^>]+>|\S+)", clean, re.M):
        definitions[" ".join(match[1].lower().split())] = match[2].strip("<>")
        spans.append(match.span())
    for match in re.finditer(r"!?\[(?:\\.|[^]\\])*\]\(", clean):
        start, depth, escaped = match.end(), 0, False
        if start < len(clean) and clean[start] == "<":
            end = clean.find(">", start + 1)
            if end == -1:
                continue
            target = clean[start + 1 : end]
        else:
            end = start
            while end < len(clean):
                char = clean[end]
                if not escaped:
                    if (char == ")" and depth == 0) or (char.isspace() and depth == 0):
                        break
                    if char == "(":
                        depth += 1
                    elif char == ")":
                        depth -= 1
                escaped = char == "\\" and not escaped
                end += 1
            target = re.sub(r"\\([\\()\[\] ])", r"\1", clean[start:end])
        spans.append((match.start(), end + 1))
        if target:
            links.append(Link(html.unescape(target), clean.count("\n", 0, match.start()) + 1))
    for match in re.finditer(r"!?\[([^]\n]+)\](?:[ \t]*\[([^]\n]*)\])?", clean):
        if any(start <= match.start() < end for start, end in spans):
            continue
        key = " ".join((match[2] or match[1]).lower().split())
        if key in definitions:
            links.append(Link(definitions[key], clean.count("\n", 0, match.start()) + 1))
        elif match[2] is not None:
            links.append(Link("reference-missing:" + key, clean.count("\n", 0, match.start()) + 1))
    links.extend(HtmlLinks(clean).links)
    return links


def fragments(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() != ".md":
        return HtmlLinks(text).ids
    clean = prose(text, mask_inline=False)
    ids, counts = HtmlLinks(clean).ids, Counter()
    headings = re.findall(r"^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$", clean, re.M)
    headings.extend(re.findall(r"^([^\n]+)\n {0,3}(?:=+|-+)[ \t]*$", clean, re.M))
    for heading in headings:
        heading = html.unescape(re.sub(r"<[^>]*>", "", heading))
        heading = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", heading)
        slug = "".join(
            char
            for char in heading.lower()
            if char in "-_ " or unicodedata.category(char)[0] in "LMN"
        ).replace(" ", "-")
        ids.add(f"{slug}-{counts[slug]}" if counts[slug] else slug)
        counts[slug] += 1
    return ids


def manual_routes(root: Path) -> dict[str, tuple[Path, str]]:
    """Resolve the handbook's declared public aliases without executing server code."""
    source = root / "server/mio_server/api/manual.py"
    if not source.is_file():
        return {}
    constants = {}
    for node in ast.parse(source.read_text(encoding="utf-8-sig")).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id in {"FILES", "GUIDES"}:
                constants[target.id] = ast.literal_eval(node.value)
    directory = source.parent.parent / "manual"
    routes = {
        "/manual/" + name: (directory / value, "")
        for name, value in constants.get("FILES", {}).items()
    }
    guides = constants.get("GUIDES", {})
    for language, folder in (("guide", "zh"), ("en", "en")):
        for section in set(guides.values()):
            routes[f"/manual/docs/{language}/{section}.html"] = (
                directory / "chapters" / folder / f"{section}.html",
                "",
            )
        for name, section in guides.items():
            routes[f"/manual/docs/{language}/{name}.html"] = (
                directory / "chapters" / folder / f"{section}.html",
                "automation" if name == "API" else section,
            )
    for alias in ("/manual", "/manual/"):
        routes[alias] = (directory / "index.html", "")
    return routes


def application_routes(root: Path) -> dict[str, str]:
    """Classify declared application routes separately from physical document files."""
    routes = {}
    source = root / "web/src/app/App.tsx"
    if source.is_file():
        body = (
            source.read_text(encoding="utf-8")
            .partition("export const routes =")[2]
            .partition("];")[0]
        )
        tokens = re.findall(
            r"//[^\n]*|/\*.*?\*/|'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|[{}:]|[A-Za-z_]\w*",
            body,
            re.S,
        )
        stack = []
        for index, token in enumerate(tokens):
            if token == "{":
                stack.append({})
            elif token == "}" and stack:
                stack.pop()
            elif token == "path" and stack and tokens[index + 1 : index + 2] == [":"]:
                value = ast.literal_eval(tokens[index + 2])
                parent = next((item["path"] for item in reversed(stack[:-1]) if "path" in item), "")
                path = value if value.startswith("/") else parent.rstrip("/") + "/" + value
                stack[-1]["path"] = path
                if not any(char in path for char in ":*?"):
                    routes[path] = source.relative_to(root).as_posix()
    mount = root / "server/mio_server/api/__init__.py"
    source = root / "server/mio_server/api/v2.py"
    if mount.is_file() and source.is_file():
        mounts = ast.walk(ast.parse(mount.read_text(encoding="utf-8-sig")))
        mounted = any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "mount"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and node.args[0].value == "/api/v2"
            for node in mounts
        )
        for node in ast.walk(ast.parse(source.read_text(encoding="utf-8-sig"))):
            if (
                mounted
                and isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "FastAPI"
            ):
                keywords = {keyword.arg: keyword.value for keyword in node.keywords}
                for key, default in (
                    ("docs_url", "/docs"),
                    ("redoc_url", "/redoc"),
                    ("openapi_url", "/openapi.json"),
                ):
                    value = ast.literal_eval(keywords[key]) if key in keywords else default
                    if value:
                        routes["/api/v2" + value] = source.relative_to(root).as_posix()
    return routes


def origin(path: Path) -> str:
    if "dist" in path.parts:
        return "generated"
    if "reviews" in path.parts or re.search(r"\d{4}-\d{2}-\d{2}", path.name):
        return "historical"
    return "source"


def inspect_link(root: Path, source: Path, link: Link, routes, cache) -> tuple[str, str]:
    target = html.unescape(link.target)
    if target.startswith("reference-missing:"):
        return "broken-reference", target.partition(":")[2]
    try:
        url = urlsplit(target)
    except ValueError as exc:
        return "malformed", str(exc)
    if url.scheme == "data":
        return "embedded", "inline resource"
    if url.scheme or url.netloc:
        return "external", "not fetched"
    if re.search(r"\{[^}]*\}|<[^>]+>|\$\{|%[A-Z_]+%", unquote(target)):
        return "template", "requires substitution; not a concrete path"
    path, fragment = unquote(url.path), unquote(url.fragment)
    if path in routes["application"]:
        if fragment:
            return "unchecked-fragment", "application route; runtime DOM is not available"
        return "declared-route", routes["application"][path]
    default_fragment = ""
    if path in routes["manual"]:
        destination, default_fragment = routes["manual"][path]
    elif path.startswith("/"):
        app = next((p for p in source.parents if (p / "package.json").is_file()), root)
        destination = app / path.lstrip("/")
    else:
        destination = source.parent / path if path else source
    destination = destination.resolve()
    if not destination.is_relative_to(root):
        return "outside-root", path
    if not destination.exists():
        return "missing-path", destination.relative_to(root).as_posix()
    fragment = fragment or default_fragment
    if fragment and destination.suffix.lower() in DOCUMENT_SUFFIXES:
        if destination not in cache:
            cache[destination] = fragments(destination)
        if fragment not in cache[destination]:
            return "missing-anchor", destination.relative_to(root).as_posix() + "#" + fragment
    elif fragment:
        return "unchecked-fragment", "target is not a Markdown/HTML document"
    return "checked", ""


def check(root: Path, sources: list[Path]) -> dict:
    counts, problems, notices, cache = Counter(), [], [], {}
    routes = {"manual": manual_routes(root), "application": application_routes(root)}
    for source in sources:
        try:
            if not source.resolve().is_relative_to(root):
                raise OSError("Document source resolves outside repository root")
            text = source.read_text(encoding="utf-8-sig")
        except (UnicodeError, OSError) as exc:
            problems.append(
                {"source": str(source), "line": 0, "kind": "read-error", "detail": str(exc)}
            )
            continue
        links = markdown_links(text) if source.suffix.lower() == ".md" else HtmlLinks(text).links
        for link in links:
            kind, detail = inspect_link(root, source, link, routes, cache)
            counts[kind] += 1
            row = {
                "source": source.relative_to(root).as_posix(),
                **asdict(link),
                "origin": origin(source),
                "kind": kind,
                "detail": detail,
            }
            if kind in {"checked", "external", "embedded"}:
                continue
            (
                notices
                if kind in {"template", "unchecked-fragment", "declared-route"}
                else problems
            ).append(row)
    return {
        "documents": len(sources),
        "document_origins": dict(sorted(Counter(origin(source) for source in sources).items())),
        "counts": dict(sorted(counts.items())),
        "problems": problems,
        "notices": notices,
    }


def self_test() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        (root / "guide.md").write_text("# Same\n# Same\n# `中文标题`\n", encoding="utf-8")
        (root / "page.html").write_text('<h1 id="fine">Good</h1>', encoding="utf-8")
        (root / "a (b).md").write_text("# Nested\n", encoding="utf-8")
        source = root / "README.md"
        source.write_text(
            "[ok](guide.md#same-1) [cn](guide.md#中文标题) [html](page.html#fine)\n"
            "[nested](a%20(b).md#nested) [bad](guide.md#absent) [gone](gone.md)\n"
            "[reference][ref]\n[ref]: guide.md#same\n[absent][undefined]\n"
            "1. A list\n    - [nested missing](nested-missing.md)\n"
            "`[not a link](missing-inline.md)`\n```md\n[example](missing-code.md)\n```\n"
            "[remote](https://example.invalid/) [template](packages/{id}/README.md)\n",
            encoding="utf-8",
        )
        report = check(root, [source])
        assert report["counts"]["checked"] == 5, report
        assert {row["kind"] for row in report["problems"]} == {
            "missing-anchor",
            "missing-path",
            "broken-reference",
        }, report
        assert len(report["problems"]) == 4, report
        assert report["counts"]["external"] == report["counts"]["template"] == 1, report
        assert origin(Path("docs/reviews/date/file.md")) == "historical"
        assert origin(Path("extension/dist/index.html")) == "generated"
        for directory in (root / "docs/reviews/date", root / "extension/dist"):
            directory.mkdir(parents=True)
            path = directory / "index.md"
            path.write_text("[missing](missing.md)", encoding="utf-8")
            assert len(check(root, [path])["problems"]) == 1
    print("Document link checker self-test passed")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", help="Optional repository-relative files/directories")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--json", action="store_true", help="Print full machine-readable diagnostics"
    )
    parser.add_argument(
        "--self-test", action="store_true", help="Run isolated parser/failure probes"
    )
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    root = args.root.resolve()
    tracked = (
        subprocess.run(["git", "ls-files", "-z"], cwd=root, check=True, capture_output=True)
        .stdout.decode("utf-8")
        .split("\0")
    )
    sources = {root / name for name in tracked if Path(name).suffix.lower() in DOCUMENT_SUFFIXES}
    if args.paths:
        selected = {(root / name).resolve() for name in args.paths}
        if any(not path.exists() or not path.is_relative_to(root) for path in selected):
            parser.error("Selected paths must exist within --root")
        sources = {
            path
            for path in sources
            if any(
                path == selected_path or selected_path in path.parents for selected_path in selected
            )
        }
        sources.update(
            path for path in selected if path.is_file() and path.suffix.lower() in DOCUMENT_SUFFIXES
        )
    report = check(root, sorted(sources))
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"Checked {report['documents']} tracked Markdown/HTML documents: {report['counts']}")
        for row in report["problems"] + [
            item for item in report["notices"] if item["kind"] != "declared-route"
        ]:
            print(
                f"{row['source']}:{row['line']} [{row.get('origin', 'source')}/{row['kind']}] {row.get('target', '')} -> {row['detail']}"
            )
        print(f"{len(report['problems'])} broken links; {len(report['notices'])} explicit notices")
    return bool(report["problems"])


if __name__ == "__main__":
    sys.exit(main())
