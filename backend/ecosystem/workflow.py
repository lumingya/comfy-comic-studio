"""Deterministic ComfyUI input mappings.

Targets are relative to node.inputs, using JSON Pointer or legacy dotted paths.
Connections are immutable. This module and the browser compiler share regression
fixtures in tests/fixtures/workflow_mapping_contract.json.
"""
import copy
import json
import math
import re
from backend.mio_library import LibraryError


def input_path_parts(path):
    if not isinstance(path, str) or not path.strip():
        raise LibraryError('A workflow input path is required')
    pointer = path.startswith('/')
    if pointer and re.search(r'~(?![01])', path):
        raise LibraryError('Invalid JSON Pointer escape')
    parts = ([p.replace('~1', '/').replace('~0', '~') for p in path[1:].split('/')]
             if pointer else path.split('.'))
    if any((not pointer and not p) or p in ('__proto__', 'constructor', 'prototype') for p in parts):
        raise LibraryError('Invalid workflow input path')
    return parts


def is_link(value, workflow):
    # String node IDs are also protected when dangling. Numeric tuples are
    # considered links only when the referenced node exists.
    return (isinstance(value, list) and len(value) == 2
            and (isinstance(value[0], str)
                 or type(value[0]) in (int, float) and str(value[0]) in workflow)
            and type(value[1]) is int)


def contains_link(value, workflow):
    return (is_link(value, workflow)
            or isinstance(value, dict) and any(contains_link(v, workflow) for v in value.values())
            or isinstance(value, list) and any(contains_link(v, workflow) for v in value))


def target_slot(node, parts, allow_create, workflow):
    """Resolve a writable slot. Never traverse links, scalars or sparse arrays."""
    target = node.get('inputs')
    for index, part in enumerate(parts):
        if not isinstance(target, (dict, list)):
            raise LibraryError('Cannot traverse a scalar workflow input')
        if is_link(target, workflow):
            raise LibraryError('Cannot modify a node connection')
        if isinstance(target, list):
            if not re.fullmatch(r'0|[1-9]\d*', part) or int(part) >= len(target):
                raise LibraryError('Workflow array index must already exist')
            key = int(part)
            exists = True
        else:
            key = part
            exists = key in target
        if not exists and not allow_create:
            raise LibraryError('Workflow input field missing')
        if index == len(parts) - 1:
            original = target[key] if exists else None
            if contains_link(original, workflow):
                raise LibraryError('Cannot overwrite a node connection; map an upstream input')
            return target, key, original
        if not exists:
            if re.fullmatch(r'0|[1-9]\d*', parts[index + 1]):
                raise LibraryError('Nested arrays must already exist in the workflow')
            target[key] = {}
        target = target[key]


def validate_targets(workflow, bindings):
    seen = []
    for binding in bindings:
        node_id = str(binding.get('nodeId'))
        node = workflow.get(node_id)
        if not isinstance(node, dict) or not isinstance(node.get('inputs'), dict):
            raise LibraryError('Workflow binding node missing')
        parts = input_path_parts(binding.get('path'))
        for old_id, old_parts in seen:
            length = min(len(parts), len(old_parts))
            if old_id == node_id and parts[:length] == old_parts[:length]:
                raise LibraryError('Duplicate or overlapping enabled workflow targets')
        seen.append((node_id, parts))
        target_slot(copy.deepcopy(node), parts, binding.get('allowCreate', False), workflow)


def validate_schema(node, parts, value, object_info):
    if len(parts) != 1:
        return
    inputs = object_info.get(node.get('class_type'), {}).get('input', {})
    rule = {**inputs.get('required', {}), **inputs.get('optional', {})}.get(parts[0])
    if not isinstance(rule, list) or not rule:
        return
    kind = rule[0]
    if kind == 'INT' and (type(value) not in (int, float) or not float(value).is_integer()):
        raise LibraryError('Workflow input requires an integer')
    if kind in ('INT', 'FLOAT') and type(value) not in (int, float):
        raise LibraryError('Workflow input requires a number')
    if kind == 'BOOLEAN' and not isinstance(value, bool):
        raise LibraryError('Workflow input requires a boolean')
    if kind == 'STRING' and not isinstance(value, str):
        raise LibraryError('Workflow input requires a string')
    if isinstance(kind, list) and value not in kind:
        raise LibraryError('Workflow value is not an allowed enum option')
    limits = rule[1] if len(rule) > 1 and isinstance(rule[1], dict) else {}
    if type(value) in (int, float):
        if isinstance(limits.get('min'), (int, float)) and value < limits['min']:
            raise LibraryError('Workflow value is below its minimum')
        if isinstance(limits.get('max'), (int, float)) and value > limits['max']:
            raise LibraryError('Workflow value exceeds its maximum')


def strip_image_tokens(value):
    """Remove @image_N markers and the punctuation they leave behind."""
    if not isinstance(value, str) or '@image_' not in value:
        return value
    cleaned = re.sub(r'@image_\d+', '', value)
    cleaned = re.sub(r'[ \t]*,(?:[ \t]*,)+', ',', cleaned)
    cleaned = re.sub(r',[ \t]+', ', ', cleaned)
    cleaned = re.sub(r'[ \t]{2,}', ' ', cleaned)
    return re.sub(r'^[ \t,]+|[ \t,]+$', '', cleaned, flags=re.M)


def compile_workflow(workflow, bindings, prompt, options, images):
    workflow = copy.deepcopy(workflow)
    output_id = options.get('outputNodeId', '')
    if output_id and str(output_id) not in workflow:
        raise LibraryError('Workflow output node missing')
    staged_images = list(images)
    variables = options.get('variables', {})
    # CLIPTextEncode has no use for the @image_N placeholders that the cloud
    # builders rely on; the images reach ComfyUI through LoadImage bindings.
    prompt = strip_image_tokens(prompt)
    options = {**options, 'negative': strip_image_tokens(options.get('negative', ''))}
    active = [b for b in bindings if b.get('enabled') and b.get('source') != 'inherit'
              and (b.get('source') != 'sceneParameter' or options.get('renderOverride'))]
    # Validate all targets against the immutable blueprint before any assignment.
    validate_targets(workflow, active)

    def text(value):
        if not isinstance(value, str):
            return value
        return re.sub(r'\{([\w]+)\}', lambda m: str(variables[m[1]]) if m[1] in variables else m[0], value)

    for b in active:
        source = b.get('source')
        node = workflow[str(b.get('nodeId'))]
        _, _, original = target_slot(copy.deepcopy(node), input_path_parts(b.get('path')), b.get('allowCreate', False), workflow)
        values = {'positive': prompt, 'negative': options.get('negative', ''),
                  'random': options.get('seed', 1), 'bookTitle': options.get('title', '前置资产'),
                  'sceneName': options.get('sceneName', options.get('title', '前置资产')),
                  'caption': options.get('caption', '')}
        if source == 'variable':
            name = str(b.get('value', '')).strip('{}')
            if name not in variables or variables[name] in (None, ''):
                continue
            value = variables[name]
            if isinstance(value, dict) and value.get('kind') == 'mio-image':
                if not value.get('src'):
                    continue
                # An image referenced from the prompt is already staged; reuse its
                # slot instead of appending a duplicate that leaves slot 1 unbound.
                if value['src'] not in staged_images:
                    staged_images.append(value['src'])
                value = 'mio-image://' + str(staged_images.index(value['src']) + 1)
        elif source == 'image':
            if not staged_images:
                continue
            value = 'mio-image://1'
        elif source == 'literal':
            value = text(b.get('value', ''))
        elif source == 'sceneParameter':
            if b.get('value') not in options:
                raise LibraryError('Missing mapped frame parameter')
            value = options[b['value']]
        elif source == 'negative' and not str(values['negative'] or '').strip():
            # An empty scene negative never blanks the curated negative already in
            # the blueprint; the node keeps its original text.
            continue
        elif source in values:
            value = values[source]
        else:
            raise LibraryError('Unsupported workflow source: ' + str(source))
        typ = b.get('type', 'auto')
        if typ == 'auto':
            typ = ('boolean' if isinstance(original, bool) else 'number' if isinstance(original, (int, float))
                   else 'json' if isinstance(original, (dict, list)) else 'text')
        if typ == 'number':
            if value is None or isinstance(value, (list, dict)) or isinstance(value, str) and not value.strip():
                raise LibraryError('Mapped value is not a number')
            try:
                value = float(value)
            except (ValueError, TypeError):
                raise LibraryError('Mapped value is not a number') from None
            if not math.isfinite(value):
                raise LibraryError('Mapped number is not finite')
            if value.is_integer():
                value = int(value)
        elif typ == 'boolean':
            if value in (True, 'true', '1', 1):
                value = True
            elif value in (False, 'false', '0', 0):
                value = False
            else:
                raise LibraryError('Mapped boolean requires true/false or 1/0')
        elif typ == 'json':
            try:
                value = json.loads(value) if isinstance(value, str) else copy.deepcopy(value)
                json.dumps(value, allow_nan=False)
            except (ValueError, TypeError):
                raise LibraryError('Mapped value is not valid JSON') from None
        elif typ == 'text':
            value = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) if isinstance(value, (dict, list))
                     else 'true' if value is True else 'false' if value is False else str(value if value is not None else ''))
        else:
            raise LibraryError('Unsupported workflow value type')
        validate_schema(node, input_path_parts(b.get('path')), value, options.get('objectInfo', {}))
        target, key, _ = target_slot(node, input_path_parts(b.get('path')), b.get('allowCreate', False), workflow)
        target[key] = value
    images[:] = staged_images
    return workflow
