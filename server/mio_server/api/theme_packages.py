"""Independent theme package import/export, shared by local and open APIs."""

import re
import secrets
import shutil
import tempfile
from html.parser import HTMLParser
from pathlib import Path

from fastapi import Request
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from ..storage import NotFound
from ..theme_media import (
    MAX_STYLESHEET_BYTES,
    _skip_string,
    _strip_comments,
    asset_parts,
    validate_stylesheet,
)
from ..theme_packages import (
    MAX_FILES,
    MAX_PACKAGE,
    MAX_SETTINGS_PAGE,
    SCRIPT,
    STYLE,
    _folder_files,
    _read_folder,
    _regular_path,
    package_theme_to_file,
)
from ..themes import Theme
from .deps import Ctx
from .operations import Router as APIRouter
from .uploads import multipart_uploads

router = APIRouter(tags=["themes"])

SETTINGS_PAGE_CSP = (
    "default-src 'none'; style-src 'unsafe-inline'; "
    "img-src data: blob:; media-src data: blob:; font-src 'none'; worker-src 'none'; "
    "connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; "
    "base-uri 'none'; navigate-to 'none'; frame-ancestors 'self'; sandbox allow-scripts"
)


def _theme(ctx, theme_id: str) -> Theme:
    contribution = next((item for item in ctx.registry.all("theme") if item.id == theme_id), None)
    if contribution is None:
        raise NotFound(f"主题不存在：{theme_id}")
    return contribution.value


@router.get("/themes/{theme_id}", response_model=Theme)
def get_theme(ctx: Ctx, theme_id: str) -> Theme:
    """Return an editable theme JSON document accepted by the existing import endpoint."""
    return _theme(ctx, theme_id)


@router.get(
    "/themes/{theme_id}/package",
    response_class=Response,
    responses={
        200: {"content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}}}
    },
)
def export_theme_package(ctx: Ctx, theme_id: str) -> Response:
    """Download an inert theme folder as a ZIP, ready to import on another installation."""
    contribution = next((item for item in ctx.registry.all("theme") if item.id == theme_id), None)
    if contribution is None:
        raise NotFound(f"主题不存在：{theme_id}")
    theme = contribution.value
    resources: dict[str, Path] = {}
    if (
        theme.background or theme.script_file or theme.style_file or theme.settings_page
    ) and contribution.source in {"builtin", "theme-package"}:
        root = (
            ctx.theme_packages.bundled_root
            if contribution.source == "builtin"
            else ctx.theme_packages.root
        )
        try:
            folder = root / theme_id
            _read_folder(folder)
            resources = {
                name: path
                for name, path in _folder_files(folder)
                if name not in {"mio-theme.json", "theme.json", "README.md"}
            }
        except (OSError, ValueError) as exc:
            raise NotFound("主题资源不存在或无效") from exc
    elif contribution.source.startswith("ext:"):
        ext_id = contribution.source.removeprefix("ext:")
        loaded = (ctx.extensions.loaded if ctx.extensions else {}).get(ext_id)
        if loaded is None:
            raise NotFound("主题扩展未启用")
        asset_names: set[str] = set()
        if theme.style_file:
            from ..extensions.manifest import inside

            style_path = inside(loaded.api.folder, theme.style_file)
            _regular_path(style_path, directory=False)
            if style_path.stat().st_size > MAX_STYLESHEET_BYTES:
                raise NotFound("主题样式文件过大")
            stylesheet = style_path.read_text(encoding="utf-8")
            asset_root = loaded.api.folder / "assets"
            available = {
                path.relative_to(loaded.api.folder).as_posix()
                for path in asset_root.rglob("*")
                if path.is_file() and asset_parts(path.relative_to(loaded.api.folder).as_posix())
            }
            asset_names = validate_stylesheet(stylesheet, available)
            resources[theme.style_file] = style_path
        if theme.background:
            asset_names.add(theme.background.file)
        for name in (*asset_names, theme.script_file):
            if name:
                from ..extensions.manifest import inside

                path = inside(loaded.api.folder, name)
                _regular_path(path, directory=False)
                resources[name] = path
    temporary = tempfile.mkdtemp(prefix="mio-theme-export-")
    package_path = Path(temporary) / "theme.zip"
    try:
        package_id = package_theme_to_file(theme, resources, package_path)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return FileResponse(
        package_path,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{package_id}.zip"'},
        background=BackgroundTask(shutil.rmtree, temporary, ignore_errors=True),
    )


@router.post(
    "/themes/package",
    status_code=201,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def import_theme_package(ctx: Ctx, request: Request) -> dict:
    """Install a data-only theme ZIP into the workspace theme folder."""
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_PACKAGE:
        raise ValueError("主题包超过 10 GiB")
    with tempfile.TemporaryDirectory(prefix="mio-theme-upload-") as temporary:
        archive = Path(temporary) / "theme.zip"
        size = 0
        with archive.open("xb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_PACKAGE:
                    raise ValueError("主题包超过 10 GiB")
                output.write(chunk)
        return await run_in_threadpool(ctx.theme_packages.install_package_path, archive)


@router.post(
    "/themes/folder",
    status_code=201,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["files"],
                        "properties": {
                            "files": {
                                "type": "array",
                                "items": {"type": "string", "format": "binary"},
                            }
                        },
                    }
                }
            },
        }
    },
)
async def import_theme_folder(ctx: Ctx, request: Request) -> dict:
    """Install a directly selected theme folder without routing it through extensions."""
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data;") or any(
        char in content_type for char in "\r\n"
    ):
        raise ValueError("请上传主题文件夹")
    uploads = await multipart_uploads(
        request,
        max_files=MAX_FILES,
        max_file_bytes=MAX_PACKAGE,
        max_body_bytes=MAX_PACKAGE + 2 * 1024 * 1024,
    )
    try:
        streams = []
        for field, upload in uploads:
            if field != "files" or not isinstance(upload, UploadFile):
                raise ValueError("请以 files 字段上传主题文件")
            streams.append((upload.filename or "", upload.file))
        return await run_in_threadpool(ctx.theme_packages.install_folder_streams, streams)
    finally:
        for _, upload in uploads:
            await upload.close()


def _theme_file(ctx, theme_id: str, name: str, *, allow_settings_page: bool = False) -> Path:
    theme = _theme(ctx, theme_id)
    declared = {
        value
        for value in (
            theme.script_file,
            theme.style_file,
            theme.background.file if theme.background else None,
            theme.settings_page if allow_settings_page else None,
        )
        if value
    }
    if name not in declared and asset_parts(name) is None:
        raise NotFound("主题资源不存在")
    contribution = next(item for item in ctx.registry.all("theme") if item.id == theme_id)
    if contribution.source == "builtin":
        folder = ctx.theme_packages.bundled_root / theme_id
    elif contribution.source == "theme-package":
        folder = ctx.theme_packages.root / theme_id
    elif contribution.source.startswith("ext:"):
        ext_id = contribution.source.removeprefix("ext:")
        loaded = (ctx.extensions.loaded if ctx.extensions else {}).get(ext_id)
        if loaded is None:
            raise NotFound("主题扩展未启用")
        from ..extensions.manifest import inside

        try:
            target = inside(loaded.api.folder, name)
            _regular_path(target, directory=False)
        except (OSError, ValueError) as exc:
            raise NotFound("主题资源不存在或路径无效") from exc
        return target
    else:
        raise NotFound("主题不包含外部资源")
    target = folder / name
    try:
        _regular_path(folder, directory=True)
        parent = target.parent
        while parent != folder:
            _regular_path(parent, directory=True)
            parent = parent.parent
        _regular_path(target, directory=False)
    except (OSError, ValueError) as exc:
        raise NotFound("主题资源不存在或路径无效") from exc
    return target


@router.get("/themes/{theme_id}/assets/{path:path}", include_in_schema=False)
def theme_asset(ctx: Ctx, theme_id: str, path: str) -> FileResponse:
    filename = _theme_file(ctx, theme_id, f"assets/{path}")
    return FileResponse(
        filename,
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
        },
    )


@router.get("/themes/{theme_id}/script", include_in_schema=False)
def theme_script(ctx: Ctx, theme_id: str) -> FileResponse:
    filename = _theme_file(ctx, theme_id, SCRIPT)
    return FileResponse(
        filename,
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "attachment",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


class _InlineScriptNonceInjector(HTMLParser):
    def __init__(self, page: str, nonce: str):
        super().__init__(convert_charrefs=False)
        self._nonce = nonce
        self._line_offsets = [0]
        self._line_offsets.extend(index + 1 for index, char in enumerate(page) if char == "\n")
        self.replacements: list[tuple[int, int, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "script" or any(name == "src" for name, _ in attrs):
            return
        start_tag = self.get_starttag_text()
        start_tag = re.sub(
            r"\s+nonce(?:\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+))?",
            "",
            start_tag,
            count=1,
            flags=re.IGNORECASE,
        )
        opening = re.match(r"<script\b", start_tag, re.IGNORECASE)
        if opening is None:
            return
        start_tag = (
            f'{start_tag[: opening.end()]} nonce="{self._nonce}"{start_tag[opening.end() :]}'
        )
        line, column = self.getpos()
        start = self._line_offsets[line - 1] + column
        self.replacements.append((start, start + len(self.get_starttag_text()), start_tag))


def _nonce_inline_scripts(page: str, nonce: str) -> str:
    parser = _InlineScriptNonceInjector(page, nonce)
    parser.feed(page)
    parser.close()
    for start, end, replacement in reversed(parser.replacements):
        page = f"{page[:start]}{replacement}{page[end:]}"
    return page


def _settings_bridge(nonce: str) -> str:
    return (
        f'<script nonce="{nonce}">(()=>{{'
        "const session=new URLSearchParams(location.hash.slice(1)).get('mio-theme-session');"
        "if(!session||!/^[A-Za-z0-9_-]{20,80}$/.test(session))return;"
        "const pending=new Map();let nextRequestId=0;"
        "window.addEventListener('message',event=>{const message=event.data;"
        "if(event.source!==window.parent||!message||message.session!==session)return;"
        "if(message.type!=='mio:theme:response'||typeof message.requestId!=='string')return;"
        "const request=pending.get(message.requestId);if(!request)return;"
        "window.clearTimeout(request.timer);pending.delete(message.requestId);"
        "if(typeof message.error==='string')request.reject(new Error(message.error));"
        "else request.resolve(message.settings);});"
        "function send(action,settings){return new Promise((resolve,reject)=>{"
        "const requestId=String(++nextRequestId);"
        "const timer=window.setTimeout(()=>{pending.delete(requestId);"
        "reject(new Error('Settings request timed out'));},30000);"
        "pending.set(requestId,{resolve,reject,timer});"
        "const message={session,type:'mio:theme:request',requestId,action};"
        "if(action==='updateSettings')message.settings=settings;"
        "window.parent.postMessage(message,'*');});}"
        "const bridge=Object.freeze(Object.assign(Object.create(null),{"
        "getSettings:()=>send('getSettings'),"
        "updateSettings:settings=>{if(settings===null||typeof settings!=='object'||Array.isArray(settings))"
        "return Promise.reject(new TypeError('Settings must be an object'));"
        "let encoded;try{encoded=JSON.stringify(settings);}catch{return Promise.reject(new TypeError('Invalid settings'));}"
        "if(typeof encoded!=='string'||new TextEncoder().encode(encoded).length>65536)"
        "return Promise.reject(new TypeError('Settings are too large'));"
        "return send('updateSettings',JSON.parse(encoded));}}));"
        "Object.defineProperty(window,'theme',{value:bridge,enumerable:true,configurable:false,writable:false});"
        "window.parent.postMessage({session,type:'mio:theme:ready'},'*');})();</script>"
    )


@router.get("/themes/{theme_id}/settings-page", include_in_schema=False)
def theme_settings_page(ctx: Ctx, theme_id: str) -> Response:
    contribution = next((item for item in ctx.registry.all("theme") if item.id == theme_id), None)
    if (
        contribution is None
        or contribution.source != "theme-package"
        or not contribution.value.settings_page
    ):
        raise NotFound("主题设置页面不存在")
    filename = _theme_file(
        ctx, theme_id, contribution.value.settings_page, allow_settings_page=True
    )
    try:
        if filename.stat().st_size > MAX_SETTINGS_PAGE:
            raise ValueError("theme settings page exceeds 2 MB")
        page = filename.read_text(encoding="utf-8")
    except (OSError, UnicodeError, ValueError) as exc:
        raise NotFound("主题设置页面无效") from exc
    nonce = secrets.token_hex(24)
    bridge = _settings_bridge(nonce)
    page = _nonce_inline_scripts(page, nonce)
    doctype = re.match(r"^\s*<!doctype\b[^>]*>", page, re.IGNORECASE)
    if doctype:
        page = f"{page[: doctype.end()]}{bridge}{page[doctype.end() :]}"
    else:
        page = f"{bridge}{page}"
    return Response(
        page,
        media_type="text/html; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "Content-Security-Policy": f"{SETTINGS_PAGE_CSP} script-src 'nonce-{nonce}'",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _validated_stylesheet(ctx, theme_id: str) -> tuple[Path, str]:
    filename = _theme_file(ctx, theme_id, STYLE)
    try:
        if filename.stat().st_size > MAX_STYLESHEET_BYTES:
            raise ValueError("theme.css exceeds 2 MB")
        source = filename.read_text(encoding="utf-8")
        assets = {
            path.relative_to(filename.parent).as_posix()
            for path in (filename.parent / "assets").rglob("*")
            if path.is_file() and asset_parts(path.relative_to(filename.parent).as_posix())
        }
        validate_stylesheet(source, assets)
    except (OSError, UnicodeError, ValueError) as exc:
        raise NotFound("主题样式无效") from exc
    return filename, source


def _card_scoped_rules(source: str, theme_id: str) -> str:
    source = _strip_comments(source)
    scope = f'.theme-card[data-theme-id="{theme_id}"]'
    rules: list[str] = []
    cursor = 0
    while cursor < len(source):
        while cursor < len(source) and (source[cursor].isspace() or source[cursor] == ";"):
            cursor += 1
        start = cursor
        parentheses = 0
        brackets = 0
        while cursor < len(source):
            char = source[cursor]
            if char in "\"'":
                cursor = _skip_string(source, cursor)
                continue
            if char == "(":
                parentheses += 1
            elif char == ")":
                parentheses -= 1
            elif char == "[":
                brackets += 1
            elif char == "]":
                brackets -= 1
            elif parentheses == 0 and brackets == 0:
                if char == ";":
                    cursor += 1
                    break
                if char == "{":
                    break
                if char == "}":
                    return ""
            cursor += 1
        if cursor >= len(source):
            break
        if source[cursor] != "{":
            continue
        selector = source[start:cursor].strip()
        body_start = cursor + 1
        depth = 1
        nested = False
        cursor += 1
        while cursor < len(source) and depth:
            char = source[cursor]
            if char in "\"'":
                cursor = _skip_string(source, cursor)
                continue
            if char == "{":
                depth += 1
                nested = True
            elif char == "}":
                depth -= 1
            cursor += 1
        if depth:
            return ""
        body = source[body_start : cursor - 1]
        suffix = selector[len(scope) :] if selector.startswith(scope) else ""
        rooted = selector == scope
        if suffix and suffix[0] in " \t\r\n:>.[#":
            rooted = True
            suffix_parentheses = 0
            suffix_brackets = 0
            suffix_cursor = 0
            while suffix_cursor < len(suffix):
                char = suffix[suffix_cursor]
                if char in "\"'":
                    suffix_cursor = _skip_string(suffix, suffix_cursor)
                    continue
                if char == "(":
                    suffix_parentheses += 1
                elif char == ")":
                    suffix_parentheses -= 1
                elif char == "[":
                    suffix_brackets += 1
                elif char == "]":
                    suffix_brackets -= 1
                elif suffix_parentheses == 0 and suffix_brackets == 0 and char in "+~":
                    rooted = False
                    break
                suffix_cursor += 1
        if not selector.startswith("@") and "," not in selector and not nested and rooted:
            rules.append(f"{selector} {{{body}}}")
    return "\n".join(rules)


@router.get("/themes/{theme_id}/style", include_in_schema=False)
def theme_style(ctx: Ctx, theme_id: str) -> FileResponse:
    filename, _ = _validated_stylesheet(ctx, theme_id)
    return FileResponse(
        filename,
        media_type="text/css; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/themes/{theme_id}/card-style", include_in_schema=False)
def theme_card_style(ctx: Ctx, theme_id: str) -> Response:
    _, source = _validated_stylesheet(ctx, theme_id)
    scoped = _card_scoped_rules(source, theme_id)
    if not scoped:
        raise NotFound("主题没有卡片专用样式")
    return Response(
        scoped,
        media_type="text/css; charset=utf-8",
        headers={"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/themes/{theme_id}", status_code=204)
def delete_theme(ctx: Ctx, theme_id: str, delete_data: bool = False) -> None:
    from ..backups.extension_data import validate_tree
    from ..private_store import PrivateStore

    with ctx.engine.hold_operation():
        contribution = next(
            (item for item in ctx.registry.all("theme") if item.id == theme_id), None
        )
        if contribution is None:
            raise NotFound(f"主题不存在：{theme_id}")
        if contribution.source == "theme-package":
            ctx.theme_packages.remove(theme_id, delete_data=delete_data)
        elif contribution.source == "user":
            private_data = tuple(
                dict.fromkeys(PrivateStore(ctx.data_dir, "theme", theme_id).sources())
            )
            if delete_data:
                for path in private_data:
                    validate_tree(path)
            ctx.store.delete_doc("theme", theme_id)
            ctx.registry.unregister("theme", theme_id)
            if delete_data:
                for path in private_data:
                    if path.exists():
                        shutil.rmtree(path)
        else:
            raise ValueError("只能删除自己导入的主题")
