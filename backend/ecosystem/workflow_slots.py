"""Semantic model / LoRA slots for ComfyUI API workflows.

Mirror of js/workflow-slots.js; both sides share tests/fixtures/workflow_slots_contract.json.

A slot is a meaning ("the base model", "the LoRA set"), not a node type. Detection reads input
names, values and links, so no per-plugin table is needed:

* model slot – a string input naming a weights file whose node feeds a ``model`` input;
* LoRA slot  – one of three adaptive modes chosen from what the blueprint contains:
  ``syntax`` injects ``<lora:name:strength>`` tags into a text field, ``chain`` fills
  LoraLoader-style nodes wired in series (growing or shrinking the chain), ``stack`` fills the
  numbered slots of a stacker node.

``apply`` never mutates its input and returns a plain API payload.
"""
import copy
import re
from backend.mio_library import LibraryError

MODEL_EXT = re.compile(r'\.(safetensors|ckpt|pt|pth|bin|gguf|sft|pkl)$', re.I)
STRONG_MODEL_KEYS = re.compile(r'^(ckpt_name|unet_name)$', re.I)
WEAK_MODEL_KEYS = re.compile(r'^(checkpoint|ckpt|model_name|model|model_path|diffusion_model|base_model|unet|transformer)$', re.I)
NOT_MODEL = re.compile(r'lora|vae|clip|control|upscale|ipadapter|adapter|embedding|face|detect|bbox|segm|sam\b|encoder|tokenizer|scheduler|style|instantid|photomaker|pulid|insight|onnx|preprocessor|depth|pose|animatediff|motion|gligen|hypernet|audio|llm|florence|vision|refiner_', re.I)
MODEL_CLASS = re.compile(r'checkpoint|unet|diffusion|model.?loader|dit.?loader', re.I)
STACK_KEY = re.compile(r'^(lora|lora_name)_?(\d+)$', re.I)
CHAIN_NAME_KEYS = ['lora_name', 'lora']
CHAIN_STRENGTH_KEYS = ['strength_model', 'strength', 'lora_strength', 'model_strength', 'lora_model_strength', 'model_weight', 'lora_wt', 'weight']
CHAIN_CLIP_KEYS = ['strength_clip', 'clip_strength', 'lora_clip_strength', 'clip_weight']
STACK_STRENGTH_PREFIXES = ['strength', 'lora_wt', 'model_weight', 'model_str', 'strength_model', 'lora_strength', 'weight']
STACK_CLIP_PREFIXES = ['clip_weight', 'clip_str', 'strength_clip', 'clip_strength']
STACK_SWITCH_PREFIXES = ['switch', 'enabled', 'on']
PASSTHROUGH_KEYS = ['model', 'clip', 'prev_lora', 'lora_stack']
SYNTAX_TEXT_KEYS = re.compile(r'text|prompt', re.I)
LORA_TAG = re.compile(r'<lora:([^<>:]+?)(?::(-?\d*\.?\d+))?(?::(-?\d*\.?\d+))?\s*>')
MAX_LORAS = 16
_MISSING = object()


def _is_number(value):
    return type(value) in (int, float)


def _is_link(value, workflow):
    return (isinstance(value, list) and len(value) == 2
            and (isinstance(value[0], str) or (_is_number(value[0]) and str(value[0]) in workflow))
            and type(value[1]) is int)


def _sort_key(node_id):
    try:
        return (0, float(node_id), '')
    except (TypeError, ValueError):
        return (1, 0.0, str(node_id))


def _node_ids(workflow):
    ids = [i for i, n in (workflow or {}).items() if isinstance(n, dict) and isinstance(n.get('inputs'), dict)]
    return sorted(ids, key=_sort_key)


def _title(node):
    meta = node.get('_meta') if isinstance(node, dict) else None
    return str((meta or {}).get('title') or node.get('class_type') or '')


def number_text(value):
    value = round(float(value) * 100) / 100
    if value == int(value):
        return str(int(value))
    text = ('%.2f' % value).rstrip('0').rstrip('.')
    return text


def strip_extension(name):
    return MODEL_EXT.sub('', str(name))


def lora_stem(name):
    return strip_extension(str(name).replace('\\', '/').split('/')[-1])


def lora_display_name(name, fmt):
    if fmt == 'file':
        return str(name)
    if fmt == 'path':
        return strip_extension(str(name).replace('\\', '/'))
    return lora_stem(name)


def _consumer_index(workflow):
    index = {}
    for node_id in _node_ids(workflow):
        for key, value in workflow[node_id]['inputs'].items():
            if _is_link(value, workflow):
                index.setdefault(str(value[0]), []).append({'consumer': node_id, 'key': key, 'index': value[1]})
    return index


# ---- model slot ------------------------------------------------------------------------------
def catalog_from_object_info(object_info):
    lists = {'checkpoints': set(), 'unets': set(), 'loras': set(), 'vaes': set()}
    kinds = {'ckpt_name': 'checkpoints', 'unet_name': 'unets', 'lora_name': 'loras', 'vae_name': 'vaes'}
    for definition in (object_info or {}).values():
        inputs = definition.get('input', {}) if isinstance(definition, dict) else {}
        for group in (inputs.get('required') or {}, inputs.get('optional') or {}):
            for field, rule in group.items():
                kind = kinds.get(field)
                if not kind or not isinstance(rule, list) or not rule or not isinstance(rule[0], list):
                    continue
                for option in rule[0]:
                    if isinstance(option, str) and option and option != 'None':
                        lists[kind].add(option)
    return {k: sorted(v, key=lambda s: s.lower()) for k, v in lists.items()}


def _field_enum(node, key, object_info):
    inputs = (object_info or {}).get(node.get('class_type'), {}).get('input', {}) if isinstance(object_info, dict) else {}
    rule = {**(inputs.get('required') or {}), **(inputs.get('optional') or {})}.get(key)
    return rule[0] if isinstance(rule, list) and rule and isinstance(rule[0], list) else None


def model_candidates(workflow, object_info=None):
    consumers = _consumer_index(workflow)
    catalog = catalog_from_object_info(object_info)
    checkpoints, unets = set(catalog['checkpoints']), set(catalog['unets'])
    found = []
    for node_id in _node_ids(workflow):
        node = workflow[node_id]
        class_type = str(node.get('class_type') or '')
        for key, value in node['inputs'].items():
            if not isinstance(value, str):
                continue
            kind = 'model'
            if STRONG_MODEL_KEYS.match(key):
                score = 3
                kind = 'unet' if key.lower().startswith('unet') else 'checkpoint'
            elif WEAK_MODEL_KEYS.match(key):
                if NOT_MODEL.search(class_type):
                    continue
                score = 2
            elif MODEL_EXT.search(value):
                if NOT_MODEL.search(key) or NOT_MODEL.search(class_type):
                    continue
                score = 1
            else:
                continue
            if MODEL_EXT.search(value):
                score += 1
            if MODEL_CLASS.search(class_type):
                score += 1
            if any(c['key'] == 'model' for c in consumers.get(node_id, [])):
                score += 2
            options = _field_enum(node, key, object_info)
            if options:
                hits = [o for o in options if o in checkpoints or o in unets]
                if hits and all(o in checkpoints for o in options):
                    kind, score = 'checkpoint', score + 1
                elif hits and all(o in unets for o in options):
                    kind, score = 'unet', score + 1
                elif not hits and (checkpoints or unets):
                    score -= 2
            if score <= 0:
                continue
            found.append({'nodeId': node_id, 'path': key, 'classType': class_type, 'title': _title(node),
                          'value': value, 'kind': kind, 'score': score})
    found.sort(key=lambda c: (-c['score'], _sort_key(c['nodeId'])))
    return found


# ---- LoRA slot -------------------------------------------------------------------------------
def _first_key(inputs, keys):
    for key in keys:
        if key in inputs:
            return key
    return ''


def stack_slots(node, workflow):
    slots = []
    for key, value in node['inputs'].items():
        match = STACK_KEY.match(key)
        if not match or _is_link(value, workflow):
            continue
        token = match.group(2)
        object_style = isinstance(value, dict)
        if not object_style and not isinstance(value, str):
            continue

        def siblings(prefixes):
            return [] if object_style else [p + '_' + token for p in prefixes if (p + '_' + token) in node['inputs']]
        strength_paths, clip_paths, switch_paths = siblings(STACK_STRENGTH_PREFIXES), siblings(STACK_CLIP_PREFIXES), siblings(STACK_SWITCH_PREFIXES)
        slots.append({'index': int(token), 'token': token, 'namePath': key, 'objectStyle': object_style,
                      'strengthPaths': strength_paths, 'clipPaths': clip_paths,
                      'strengthPath': strength_paths[0] if strength_paths else '',
                      'clipPath': clip_paths[0] if clip_paths else '',
                      'switchPath': switch_paths[0] if switch_paths else ''})
    slots.sort(key=lambda s: s['index'])
    return slots


def chain_descriptor(node_id, workflow):
    node = workflow[node_id]
    inputs = node['inputs']
    if stack_slots(node, workflow):
        return None
    name_path = next((k for k in CHAIN_NAME_KEYS if k in inputs and not _is_link(inputs[k], workflow)
                      and (isinstance(inputs[k], str) or inputs[k] is None)), None)
    if not name_path:
        return None
    strength_path, clip_path = _first_key(inputs, CHAIN_STRENGTH_KEYS), _first_key(inputs, CHAIN_CLIP_KEYS)
    if not strength_path and not re.search(r'lora', str(node.get('class_type') or ''), re.I):
        return None
    passthrough = [k for k in PASSTHROUGH_KEYS if k in inputs]
    if not passthrough and re.search(r'wan.*lora|loraselect', str(node.get('class_type') or ''), re.I):
        passthrough = ['prev_lora']
    return {'nodeId': node_id, 'classType': str(node.get('class_type') or ''), 'title': _title(node), 'namePath': name_path,
            'strengthPath': strength_path, 'clipPath': clip_path, 'passthrough': passthrough, 'value': inputs[name_path],
            'strength': inputs[strength_path] if strength_path else None, 'clip': inputs[clip_path] if clip_path else None}


def _chain_parent(descriptor, workflow, chain_ids):
    node, guard = workflow[descriptor['nodeId']], 0
    while node and guard < 64:
        guard += 1
        key = next((k for k in PASSTHROUGH_KEYS if _is_link(node['inputs'].get(k), workflow)), None)
        if not key:
            return ''
        source = str(node['inputs'][key][0])
        if source in chain_ids:
            return source
        node = workflow.get(source)
        if not isinstance(node, dict) or not isinstance(node.get('inputs'), dict):
            return ''
    return ''


def ordered_chain(workflow, anchor):
    all_nodes = {}
    for node_id in _node_ids(workflow):
        descriptor = chain_descriptor(node_id, workflow)
        if descriptor:
            all_nodes[node_id] = descriptor
    ids = set(all_nodes)
    if not ids:
        return []
    children = {}
    for node_id in ids:
        parent = _chain_parent(all_nodes[node_id], workflow, ids)
        if parent:
            children.setdefault(parent, []).append(node_id)
    start = str(anchor) if anchor and str(anchor) in ids else ''
    if not start:
        roots = sorted([i for i in ids if not _chain_parent(all_nodes[i], workflow, ids)], key=_sort_key)

        def depth(node_id, seen=()):
            if node_id in seen:
                return 1
            return 1 + max([0] + [depth(c, seen + (node_id,)) for c in children.get(node_id, [])])
        roots.sort(key=lambda i: (-depth(i), _sort_key(i)))
        start = roots[0] if roots else sorted(ids, key=_sort_key)[0]
    chain, current, seen = [], start, set()
    while current and current not in seen:
        seen.add(current)
        chain.append(all_nodes[current])
        nxt = sorted(children.get(current, []), key=_sort_key)
        current = nxt[0] if nxt else ''
    return chain


def _mirror_path_for(node, workflow):
    for key, value in node['inputs'].items():
        if _is_link(value, workflow):
            continue
        if isinstance(value, list):
            entries = value
        elif isinstance(value, dict) and isinstance(value.get('__value__'), list):
            entries = value['__value__']
        else:
            continue
        if not entries and key == 'loras':
            return key
        if entries and all(isinstance(e, dict) and ('name' in e or 'lora' in e) and 'strength' in e for e in entries):
            return key
    return ''


def syntax_candidates(workflow):
    found = []
    for node_id in _node_ids(workflow):
        node = workflow[node_id]
        class_type = str(node.get('class_type') or '')
        for key, value in node['inputs'].items():
            if not isinstance(value, str):
                continue
            score = 0
            if SYNTAX_TEXT_KEYS.search(key) and re.search(r'<lora:', value, re.I):
                score = 3
            elif re.search(r'lora', class_type, re.I) and key == 'text':
                score = 2
            if score:
                found.append({'nodeId': node_id, 'path': key, 'classType': class_type, 'title': _title(node), 'value': value,
                              'score': score, 'mirrorPath': _mirror_path_for(node, workflow)})
    found.sort(key=lambda c: (-c['score'], _sort_key(c['nodeId'])))
    return found


def stack_candidates(workflow):
    found = []
    for node_id in _node_ids(workflow):
        slots = stack_slots(workflow[node_id], workflow)
        if slots:
            found.append({'nodeId': node_id, 'classType': str(workflow[node_id].get('class_type') or ''),
                          'title': _title(workflow[node_id]), 'slots': slots})
    return found


def detect(workflow, object_info=None, positive=None):
    workflow = workflow if isinstance(workflow, dict) else {}
    model = model_candidates(workflow, object_info)
    syntax, chain, stack = syntax_candidates(workflow), ordered_chain(workflow, ''), stack_candidates(workflow)
    positive = positive if isinstance(positive, dict) else None
    if syntax and syntax[0]['score'] >= 2:
        recommended = {'mode': 'syntax', 'nodeId': syntax[0]['nodeId'], 'path': syntax[0]['path'], 'assumed': False}
    elif chain:
        recommended = {'mode': 'chain', 'nodeId': chain[0]['nodeId'], 'path': chain[0]['namePath'], 'assumed': False}
    elif stack:
        recommended = {'mode': 'stack', 'nodeId': stack[0]['nodeId'], 'path': stack[0]['slots'][0]['namePath'], 'assumed': False}
    elif (positive and positive.get('nodeId') and str(positive['nodeId']) in workflow
          and '/' not in str(positive.get('path') or '')[1:]):
        recommended = {'mode': 'syntax', 'nodeId': str(positive['nodeId']),
                       'path': re.sub(r'^/', '', str(positive.get('path') or 'text')), 'assumed': True}
    else:
        recommended = {'mode': 'off', 'nodeId': '', 'path': '', 'assumed': True}
    return {'model': {'candidates': model, 'primary': model[0] if model else None},
            'lora': {'syntax': syntax, 'chain': chain, 'stack': stack, 'recommended': recommended}}


def normalize(slots, workflow, object_info=None, positive=None):
    stored = slots if isinstance(slots, dict) else {}
    workflow = workflow if isinstance(workflow, dict) else {}
    detected = detect(workflow, object_info, positive)
    model_stored = stored.get('model') if isinstance(stored.get('model'), dict) else {}
    model_auto = model_stored.get('auto') is not False
    primary = detected['model']['primary']
    if model_auto:
        model = {'enabled': model_stored.get('enabled') is not False and bool(primary), 'auto': True,
                 'nodeId': primary['nodeId'] if primary else '', 'path': primary['path'] if primary else '',
                 'kind': primary['kind'] if primary else 'model'}
    else:
        model = {'enabled': model_stored.get('enabled') is not False and bool(model_stored.get('nodeId')), 'auto': False,
                 'nodeId': str(model_stored.get('nodeId') or ''), 'path': str(model_stored.get('path') or ''),
                 'kind': model_stored.get('kind') if model_stored.get('kind') in ('checkpoint', 'unet', 'model') else 'model'}
        if model['enabled']:
            node = workflow.get(model['nodeId'])
            candidate = next((c for c in detected['model']['candidates'] if c['nodeId'] == model['nodeId'] and c['path'] == model['path']), None)
            if candidate and model['kind'] == 'model':
                model['kind'] = candidate['kind']
            if not isinstance(node, dict) or model['path'] not in (node.get('inputs') or {}):
                model['enabled'] = False
    lora_stored = stored.get('lora') if isinstance(stored.get('lora'), dict) else {}
    lora_auto = lora_stored.get('auto') is not False
    rec = detected['lora']['recommended']
    if lora_auto:
        lora = {'mode': rec['mode'], 'auto': True, 'nodeId': rec['nodeId'], 'path': rec['path'], 'assumed': rec['assumed']}
        if lora_stored.get('mode') == 'off':
            lora.update(mode='off', nodeId='', path='')
    else:
        lora = {'mode': lora_stored.get('mode') if lora_stored.get('mode') in ('syntax', 'chain', 'stack', 'off') else 'off',
                'auto': False, 'nodeId': str(lora_stored.get('nodeId') or ''), 'path': str(lora_stored.get('path') or ''), 'assumed': False}
    lora['placement'] = 'prepend' if lora_stored.get('placement') == 'prepend' else 'append'
    lora['nameFormat'] = lora_stored.get('nameFormat') if lora_stored.get('nameFormat') in ('stem', 'path', 'file') else 'stem'
    lora['mirror'] = lora_stored.get('mirror') is not False
    if lora['mode'] != 'off' and (not lora['nodeId'] or not isinstance(workflow.get(lora['nodeId']), dict)):
        lora.update(mode='off', nodeId='', path='')
    if lora['mode'] == 'syntax' and lora['nodeId'] and not lora['path']:
        lora['path'] = 'text'
    return {'model': model, 'lora': lora}


# ---- current values --------------------------------------------------------------------------
def _tidy(text):
    text = re.sub(r'[ \t]+', ' ', str(text))
    text = re.sub(r' ?(,) ?(?=,)', r'\1', text)
    text = re.sub(r'^[ ,]+|[ ,]+$', '', text, flags=re.M)
    text = re.sub(r' +\n', '\n', text)
    return text.strip()


def parse_lora_syntax(text):
    loras = []

    def collect(match):
        entry = {'name': match.group(1).strip(), 'strength': 1 if match.group(2) is None else _num(match.group(2))}
        if match.group(3) is not None:
            entry['clip'] = _num(match.group(3))
        loras.append(entry)
        return ' '
    rest = LORA_TAG.sub(collect, str(text if text is not None else ''))
    return {'loras': loras, 'text': _tidy(rest)}


def _num(text):
    value = float(text)
    return int(value) if value == int(value) else value


def _is_empty_name(name):
    return name is None or str(name).strip() == '' or str(name) == 'None'


def current_model(workflow, slots):
    model = (slots or {}).get('model') or {}
    if not model.get('enabled'):
        return None
    value = ((workflow or {}).get(model.get('nodeId')) or {}).get('inputs', {}).get(model.get('path'))
    return value if isinstance(value, str) else None


def current_loras(workflow, slots):
    lora = (slots or {}).get('lora') or {}
    mode = lora.get('mode', 'off')
    if mode == 'off':
        return []
    if mode == 'syntax':
        value = ((workflow or {}).get(lora.get('nodeId')) or {}).get('inputs', {}).get(lora.get('path'))
        return parse_lora_syntax(value)['loras'] if isinstance(value, str) else []
    if mode == 'chain':
        out = []
        for d in ordered_chain(workflow, lora.get('nodeId')):
            if _is_empty_name(d['value']):
                continue
            entry = {'name': str(d['value']), 'strength': d['strength'] if _is_number(d['strength']) else 1}
            if _is_number(d['clip']):
                entry['clip'] = d['clip']
            out.append(entry)
        return out
    node = (workflow or {}).get(lora.get('nodeId'))
    if not isinstance(node, dict):
        return []
    out = []
    for slot in stack_slots(node, workflow):
        raw = node['inputs'][slot['namePath']]
        if slot['objectStyle']:
            name = raw.get('lora') if raw.get('lora') is not None else raw.get('name')
            if raw.get('on') is False or _is_empty_name(name):
                continue
            entry = {'name': str(name), 'strength': raw['strength'] if _is_number(raw.get('strength')) else 1}
            if _is_number(raw.get('strengthTwo')):
                entry['clip'] = raw['strengthTwo']
            out.append(entry)
        else:
            if _is_empty_name(raw):
                continue
            switch = node['inputs'][slot['switchPath']] if slot['switchPath'] else True
            if switch is False or switch == 'Off':
                continue
            strength = node['inputs'][slot['strengthPath']] if slot['strengthPath'] else 1
            clip = node['inputs'][slot['clipPath']] if slot['clipPath'] else None
            entry = {'name': str(raw), 'strength': strength if _is_number(strength) else 1}
            if _is_number(clip):
                entry['clip'] = clip
            out.append(entry)
    return out


# ---- overrides -------------------------------------------------------------------------------
def _round2(value):
    value = round(float(value) * 100) / 100
    return int(value) if value == int(value) else value


def normalize_loras(items):
    if not isinstance(items, list):
        raise LibraryError('LoRA 覆盖必须是数组')
    if len(items) > MAX_LORAS:
        raise LibraryError('一次最多叠加 %d 个 LoRA' % MAX_LORAS)
    out, seen = [], set()
    for raw in items:
        if not isinstance(raw, dict):
            raise LibraryError('LoRA 条目格式无效')
        name = str(raw.get('name') if raw.get('name') is not None else '').strip()
        if not name or len(name) > 300 or re.search(r'[<>\x00-\x1f]', name):
            raise LibraryError('LoRA 名称无效')
        strength = raw.get('strength', 1)
        try:
            strength = float(strength)
        except (TypeError, ValueError):
            raise LibraryError('LoRA 强度必须是 -10 到 10 之间的数字') from None
        if strength != strength or abs(strength) > 10 or strength in (float('inf'), float('-inf')):
            raise LibraryError('LoRA 强度必须是 -10 到 10 之间的数字')
        entry = {'name': name, 'strength': _round2(strength)}
        clip = raw.get('clip')
        if clip not in (None, ''):
            try:
                clip = float(clip)
            except (TypeError, ValueError):
                raise LibraryError('LoRA CLIP 强度必须是 -10 到 10 之间的数字') from None
            if clip != clip or abs(clip) > 10:
                raise LibraryError('LoRA CLIP 强度必须是 -10 到 10 之间的数字')
            entry['clip'] = _round2(clip)
        if name in seen:
            continue
        seen.add(name)
        out.append(entry)
    return out


def normalize_overrides(overrides):
    raw = overrides if isinstance(overrides, dict) else {}
    out = {}
    model = raw.get('model')
    if model not in (None, ''):
        if not isinstance(model, str) or not model.strip() or len(model) > 300 or re.search(r'[\x00-\x1f]', model):
            raise LibraryError('模型名称无效')
        out['model'] = model.strip()
    if isinstance(raw.get('loras'), list):
        out['loras'] = normalize_loras(raw['loras'])
    return out


def _write_field(workflow, node_id, key, value):
    node = workflow.get(node_id)
    if not isinstance(node, dict) or not isinstance(node.get('inputs'), dict):
        raise LibraryError('工作流里没有节点 ' + str(node_id))
    if _is_link(node['inputs'].get(key), workflow):
        raise LibraryError('节点 %s 的 %s 已连线，不能写入' % (node_id, key))
    node['inputs'][key] = value


def format_tag(lora, name_format):
    clip = ''
    if 'clip' in lora and lora['clip'] != lora['strength']:
        clip = ':' + number_text(lora['clip'])
    name = lora_display_name(lora['name'], name_format).replace(':', '_')
    return '<lora:' + name + ':' + number_text(lora['strength']) + clip + '>'


def _apply_syntax(workflow, lora, loras, notices):
    node = workflow.get(lora['nodeId'])
    if not isinstance(node, dict):
        raise LibraryError('LoRA 语法目标节点不存在')
    current = node['inputs'].get(lora['path'], _MISSING)
    if _is_link(current, workflow):
        raise LibraryError('LoRA 语法目标字段已连线，不能写入')
    if current is not _MISSING and not isinstance(current, str):
        raise LibraryError('LoRA 语法目标字段不是文本')
    base = parse_lora_syntax('' if current is _MISSING else current)['text']
    tags = ' '.join(format_tag(l, lora['nameFormat']) for l in loras)
    if not tags:
        text = base
    elif not base:
        text = tags
    elif lora['placement'] == 'prepend':
        text = tags + ('' if base[:1] in (',', '\n') else ' ') + base
    else:
        text = base + (' ' if base[-1:] in (',', '\n') else '\n' if '\n' in base else ' ') + tags
    node['inputs'][lora['path']] = text
    if lora.get('assumed') and loras:
        notices.append('工作流里没有解析 <lora:> 语法的节点，LoRA 标签已写入正向提示词；需要 LoRA Manager、Prompt Control 等插件才会生效。')
    mirror_path = '' if lora.get('mirror') is False else _mirror_path_for(node, workflow)
    if mirror_path:
        container = node['inputs'][mirror_path]
        wrapped = not isinstance(container, list)
        existing = container['__value__'] if wrapped else container
        template = existing[0] if existing else {'name': '', 'strength': 1, 'active': True, 'clipStrength': 1}
        entries = []
        for l in loras:
            entry = copy.deepcopy(template)
            if 'lora' in entry and 'name' not in entry:
                entry['lora'] = lora_display_name(l['name'], lora['nameFormat'])
            else:
                entry['name'] = lora_display_name(l['name'], lora['nameFormat'])
            entry['strength'] = l['strength']
            if 'clipStrength' in entry:
                entry['clipStrength'] = l['clip'] if 'clip' in l else l['strength']
            if 'active' in entry:
                entry['active'] = True
            if 'on' in entry:
                entry['on'] = True
            entries.append(entry)
        node['inputs'][mirror_path] = {**container, '__value__': entries} if wrapped else entries


def _apply_chain(workflow, lora, loras, notices):
    chain = ordered_chain(workflow, lora['nodeId'])
    if not chain:
        raise LibraryError('工作流里没有可用的 LoRA 加载节点')
    while len(chain) < len(loras):
        tail = chain[-1]
        tail_node = workflow[tail['nodeId']]
        base = re.sub(r':lora\d+$', '', tail['nodeId'])
        n, new_id = 1, base + ':lora1'
        while new_id in workflow:
            n += 1
            new_id = base + ':lora' + str(n)
        clone = copy.deepcopy(tail_node)
        if isinstance(clone.get('_meta'), dict) and clone['_meta'].get('title'):
            clone['_meta']['title'] = str(clone['_meta']['title']) + ' · ' + str(len(chain) + 1)
        for entry in _consumer_index(workflow).get(tail['nodeId'], []):
            if entry['index'] < len(tail['passthrough']):
                workflow[entry['consumer']]['inputs'][entry['key']] = [new_id, entry['index']]
        for i, key in enumerate(tail['passthrough']):
            clone['inputs'][key] = [tail['nodeId'], i]
        workflow[new_id] = clone
        chain = ordered_chain(workflow, lora['nodeId'])
        if chain[-1]['nodeId'] != new_id:
            raise LibraryError('LoRA 链扩展失败')
    for i, d in enumerate(chain):
        node = workflow[d['nodeId']]
        if i < len(loras):
            l = loras[i]
            node['inputs'][d['namePath']] = lora_display_name(l['name'], 'file')
            if d['strengthPath']:
                node['inputs'][d['strengthPath']] = l['strength']
            if d['clipPath']:
                node['inputs'][d['clipPath']] = l['clip'] if 'clip' in l else l['strength']
            continue
        users = _consumer_index(workflow).get(d['nodeId'], [])
        bypassable = bool(d['passthrough']) and all(
            u['index'] < len(d['passthrough']) and _is_link(node['inputs'].get(d['passthrough'][u['index']]), workflow) for u in users)
        if bypassable:
            for u in users:
                workflow[u['consumer']]['inputs'][u['key']] = copy.deepcopy(node['inputs'][d['passthrough'][u['index']]])
            del workflow[d['nodeId']]
        else:
            if d['strengthPath']:
                node['inputs'][d['strengthPath']] = 0
            if d['clipPath']:
                node['inputs'][d['clipPath']] = 0
            notices.append('LoRA 节点 %s 无法绕过，已将其强度设为 0。' % d['nodeId'])


def _apply_stack(workflow, lora, loras):
    node = workflow.get(lora['nodeId'])
    if not isinstance(node, dict):
        raise LibraryError('LoRA 堆栈节点不存在')
    slots = stack_slots(node, workflow)
    if not slots:
        raise LibraryError('节点没有可识别的 LoRA 槽位')
    object_style = slots[0]['objectStyle']
    if len(loras) > len(slots):
        if not object_style:
            raise LibraryError('LoRA 堆栈只有 %d 个槽位，无法放下 %d 个 LoRA' % (len(slots), len(loras)))
        template = node['inputs'][slots[0]['namePath']]
        base = slots[0]['namePath'][:len(slots[0]['namePath']) - len(slots[0]['token'])]
        for i in range(len(slots), len(loras)):
            node['inputs'][base + str(i + 1).rjust(len(slots[0]['token']), '0')] = copy.deepcopy(template)
        slots = stack_slots(node, workflow)
    for i, slot in enumerate(slots):
        l = loras[i] if i < len(loras) else None
        if slot['objectStyle']:
            if l is None:
                del node['inputs'][slot['namePath']]
                continue
            entry = node['inputs'][slot['namePath']]
            if 'lora' in entry or 'name' not in entry:
                entry['lora'] = lora_display_name(l['name'], 'file')
            else:
                entry['name'] = lora_display_name(l['name'], 'file')
            entry['on'] = True
            entry['strength'] = l['strength']
            if 'strengthTwo' in entry:
                entry['strengthTwo'] = l['clip'] if 'clip' in l else None
            continue
        switch_value = node['inputs'][slot['switchPath']] if slot['switchPath'] else None
        on, off = (True, False) if isinstance(switch_value, bool) else ('On', 'Off')
        if l is not None:
            node['inputs'][slot['namePath']] = lora_display_name(l['name'], 'file')
            for key in slot['strengthPaths']:
                node['inputs'][key] = l['strength']
            for key in slot['clipPaths']:
                node['inputs'][key] = l['clip'] if 'clip' in l else l['strength']
            if slot['switchPath']:
                node['inputs'][slot['switchPath']] = on
        elif slot['switchPath']:
            node['inputs'][slot['switchPath']] = off
        else:
            node['inputs'][slot['namePath']] = 'None'
            for key in slot['strengthPaths']:
                node['inputs'][key] = 0
            for key in slot['clipPaths']:
                node['inputs'][key] = 0
    if _is_number(node['inputs'].get('lora_count')):
        node['inputs']['lora_count'] = len(loras)


def apply(workflow, slots, overrides, object_info=None, positive=None):
    resolved = normalize(slots, workflow, object_info, positive)
    notices = []
    clean = normalize_overrides(overrides)
    result = copy.deepcopy(workflow or {})
    if 'model' in clean:
        if not resolved['model']['enabled']:
            raise LibraryError('当前工作流没有可写入的模型槽')
        _write_field(result, resolved['model']['nodeId'], resolved['model']['path'], clean['model'])
    if 'loras' in clean:
        lora = resolved['lora']
        if lora['mode'] == 'off':
            if clean['loras']:
                raise LibraryError('当前工作流没有可写入的 LoRA 槽')
        elif lora['mode'] == 'syntax':
            _apply_syntax(result, lora, clean['loras'], notices)
        elif lora['mode'] == 'chain':
            _apply_chain(result, lora, clean['loras'], notices)
        else:
            _apply_stack(result, lora, clean['loras'])
    return {'workflow': result, 'notices': notices, 'slots': resolved, 'overrides': clean}


def describe_overrides(overrides):
    """Short human summary for task cards: model name and LoRA list."""
    clean = overrides if isinstance(overrides, dict) else {}
    parts = []
    if isinstance(clean.get('model'), str) and clean['model']:
        parts.append(lora_stem(clean['model']))
    if isinstance(clean.get('loras'), list):
        names = [lora_stem(l.get('name', '')) + ' ×' + number_text(l.get('strength', 1)) for l in clean['loras'] if isinstance(l, dict)]
        parts.append('LoRA · ' + (', '.join(names) if names else '无'))
    return ' · '.join(parts)
