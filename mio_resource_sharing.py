"""Contextual resource sharing: inspection is read-only; imports allocate new IDs.

These routes cannot import settings, jobs or secrets. Image packages remain self-contained.
"""
import base64
import copy
import io
import json
import math
import re
import uuid
import zipfile
from mio_library import (LibraryError, MAX_BUNDLE, MAX_DOCUMENT, encode, decode, digest,
                         image_refs, image_type, share_document)

SHARE_KINDS = ('albums', 'storyboards', 'characters', 'scenes', 'layouts', 'workflows')


def expected_kinds(value):
    if value == 'variables':return ('characters', 'scenes')
    if value is None:return SHARE_KINDS
    if value not in SHARE_KINDS:raise LibraryError('未知的资源页面。')
    return (value,)


def bundle_bytes(document, files):
    files = {'resource.json': encode(document), **files}
    if sum(map(len, files.values())) > MAX_BUNDLE:raise LibraryError('分享包超过 192 MiB。', 413)
    manifest = {'schema': 'mio.resource-package.v2', 'kind': document['kind'],
                'files': {name: digest(raw) for name, raw in files.items()}}
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', encode(manifest))
        for name, raw in files.items():z.writestr(name, raw)
    return result.getvalue()


def export_document(store, kind, value):
    if kind not in SHARE_KINDS:raise LibraryError('不能通过资源页面分享此类型。')
    if not isinstance(value, dict):raise LibraryError('资源必须是 JSON 对象。')
    files = {}
    def localize(v):
        if isinstance(v, str) and v.startswith(('/images/', 'data:image/')):
            raw, name = store.image_bytes(v)
            path = 'images/' + name
            files[path] = raw
            return path
        if isinstance(v, dict):return {k:localize(x) for k,x in v.items()}
        if isinstance(v, list):return [localize(x) for x in v]
        return v
    document = share_document(kind, value)
    document.update(id=document.get('id') or 'share_' + uuid.uuid4().hex, schema='mio.resource.v2')
    document = localize(document)
    validate_content(store, kind, document)
    if kind=='albums':validated_album(store,document)
    if set(image_refs(document)) != set(files):raise LibraryError('资源包含未打包图片，请使用已保存资源的分享入口。')
    return bundle_bytes(document, files)


def validate_content(store, kind, doc):
    store.library.validate(kind, doc)
    if kind in ('characters', 'scenes'):
        if len(doc['entries']) > 2048:raise LibraryError('设定最多包含 2048 个变量。')
        keys = set()
        for entry in doc['entries']:
            if not isinstance(entry, dict):raise LibraryError('变量必须是对象。')
            key, typ = entry.get('key'), entry.get('type')
            if not isinstance(key, str) or not key or any(not (c.isalpha() or c.isnumeric() or c == '_') for c in key) or key in ('__proto__', 'constructor', 'prototype') or key in keys:
                raise LibraryError('变量名非法或重复。')
            if typ not in ('text', 'number', 'boolean', 'json', 'image'):raise LibraryError('变量类型不受支持。')
            value = entry.get('value')
            if typ == 'image':
                src = value.get('src', '') if isinstance(value, dict) and value.get('kind') == 'mio-image' else value
                if not isinstance(src, str) or src and not src.startswith('images/'):
                    raise LibraryError('图片变量必须引用分享包内的 images/ 文件。')
            elif value not in (None, ''):
                if typ == 'text' and not isinstance(value, str):raise LibraryError('文本变量的内容必须是文字。')
                if typ == 'boolean' and value not in (True, False, 'true', 'false'):raise LibraryError('开关变量需要 true 或 false。')
                if typ == 'number':
                    try:valid = not isinstance(value, bool) and math.isfinite(float(value))
                    except (TypeError, ValueError):valid = False
                    if not valid:raise LibraryError('数字变量的内容不是有效数字。')
                if typ == 'json' and isinstance(value, str):
                    try:json.loads(value)
                    except ValueError:raise LibraryError('JSON 变量的内容无法解析。') from None
            keys.add(key)
    return doc


def inspect_resource(store, body):
    allowed = expected_kinds(body.get('expectedKind'))
    if body.get('zip'):
        raw = base64.b64decode(body['zip'], validate=True)
        kind, doc, assets = store.library.inspect_bundle(raw, allowed)
    else:
        original = body.get('document')
        if not isinstance(original, dict):raise LibraryError('请选择独立 JSON 或 .mio.zip 分享包。')
        # Re-parse with the strict resource decoder before inspecting nested objects.
        original = decode(encode(original))
        kind = original.get('kind')
        if not kind:
            kind = 'storyboards' if 'frames' in original and 'steps' not in original else 'characters' if 'entries' in original else 'albums' if 'steps' in original else None
        if kind not in allowed:raise LibraryError('文件类型与当前页面不符，请在对应页面导入。')
        doc = share_document(kind, original)
        doc.update(id=doc.get('id') or 'incoming', schema='mio.resource.v2')
        assets = {}
        if list(image_refs(doc)):raise LibraryError('含独立图片的 JSON 请连同 images/ 打包为 .mio.zip。')
    if kind == 'layouts':doc['scriptEnabled'] = False
    validate_content(store, kind, doc)
    if kind=='albums':validated_album(store,doc)
    return kind, doc, assets


def import_resource(store, body):
    kind, doc, assets = inspect_resource(store, body)
    project = body.get('projectId')
    if not project:raise LibraryError('请选择目标画册集。')
    store.library.get('collections', project)
    if kind=='albums':
        from mio_album_html import import_books
        def refs(value,inline=False):
            if isinstance(value,str) and value.startswith('images/'):
                if value not in assets:raise LibraryError('缺少画册图片。')
                return 'data:'+image_type(assets[value])[0]+';base64,'+base64.b64encode(assets[value]).decode()
            if isinstance(value,dict):return {k:refs(v,inline) for k,v in value.items()}
            if isinstance(value,list):return [refs(v,inline) for v in value]
            return value
        return import_books(store,body,[validated_album(store,doc)],refs)
    doc = copy.deepcopy(doc)
    doc['projectId'] = project
    for field in ('frames', 'entries'):
        for value in doc.get(field, []):value['id'] = 'item_' + uuid.uuid4().hex
    result = store.library.put(kind, doc, create=True, assets=assets)
    return {'ok': True, 'id': result['document']['id'], 'kind': kind}


def validated_album(store,doc):
    from mio_album_html import validate_books
    sources=doc.get('sharedSources',{})
    if not isinstance(sources,dict):raise LibraryError('附带素材结构不完整。')
    item=validate_books(store,[{'album':doc,**{k:v for k,v in sources.items() if k in ('storyboard','variables')}}],lambda v:v)[0]
    # Native archives retain non-destructive picture edits and original album fields.
    item['album']={k:v for k,v in doc.items() if k not in ('sharedSources','promptSnapshots','variables')}
    return item
