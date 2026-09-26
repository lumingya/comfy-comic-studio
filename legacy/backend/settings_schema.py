"""Small shared contract for user-defined settings groups.

Groups organize presentation only; they must never alter prompt interpolation.
"""
import re


def validate_settings_groups(document):
    from backend.mio_library import LibraryError
    groups = document.get('settingsGroups', [])
    if not isinstance(groups, list) or len(groups) > 128:
        raise LibraryError('设定分组必须为数组，最多 128 组。')
    ids, titles = set(), set()
    for group in groups:
        if not isinstance(group, dict):
            raise LibraryError('分组必须是对象。')
        ident, title = group.get('id'), group.get('title')
        if not isinstance(ident, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,150}', ident) or ident in ids:
            raise LibraryError('分组标识非法或重复。')
        if not isinstance(title, str) or not title.strip() or len(title) > 60 or title.strip() in titles:
            raise LibraryError('分组名称必须为 1–60 字，且不可重复。')
        ids.add(ident)
        titles.add(title.strip())
    entries = document.get('entries', document.get('variables', []))
    if not isinstance(entries, list):
        raise LibraryError('属性必须是数组。')
    for entry in entries:
        if isinstance(entry, dict) and 'groupId' in entry:
            value = entry['groupId']
            if not isinstance(value, str) or len(value) > 150:
                raise LibraryError('属性分组标识必须是文字。')
    return document
