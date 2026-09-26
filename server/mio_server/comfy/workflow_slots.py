"""V3 semantic slots. Python is the sole analyzer; apply is a pure plan executor."""
import copy
import re
import hashlib
import json
import math
from datetime import datetime, timezone
class LibraryError(ValueError):
    """Raised when a workflow slot plan cannot be applied."""

    def __init__(self, message, code="MIO-SLOT-001", status=400):
        super().__init__(message)
        self.code = code
        self.status = status

MODEL_EXT = re.compile(r'\.(safetensors|ckpt|pt|pth|bin|gguf|sft|pkl)$', re.I)
STRONG_MODEL_KEYS = re.compile(r'^(ckpt_name|unet_name)$', re.I)
WEAK_MODEL_KEYS = re.compile(r'^(checkpoint|ckpt|model_name|model|model_path|diffusion_model|base_model|unet|transformer)$', re.I)
NOT_MODEL = re.compile(
    r'lora|vae|clip|control|upscale|ipadapter|adapter|embedding|face|detect|bbox|segm|sam\b|'
    r'encoder|tokenizer|scheduler|style|instantid|photomaker|pulid|insight|onnx|preprocessor|'
    r'depth|pose|animatediff|motion|gligen|hypernet|audio|llm|florence|vision|refiner_|'
    r'interpolation|vfi|rife|ifrnet|film|esrgan|realesrgan|gfpgan|codeformer|rembg|segmentation|'
    r'matting|depthanything|midas|zoe|openpose|dwpose|lama|inpaint_model|facerestore',
    re.I
)
NOT_MODEL_FILE = re.compile(
    r'\bamt[-_.]|[-_]amt[-_.]|\bamt.*?gopro|ifrnet|ifunet|rife|vimeo|film_net|_vfi\b|'
    r'flavr|gmflow|\bm2m\b|cain|sepconv|stmfnet|flownet|raft_|spynet|'
    r'esrgan|realesrgan|gfpgan|codeformer|depth_anything|openpose|dwpose|insightface',
    re.I
)
MODEL_CLASS = re.compile(r'checkpoint|unet|diffusion|model.?loader|dit.?loader', re.I)
STACK_KEY = re.compile(r'^(lora|lora_name)_?(\d+)(?:_name)?$', re.I)
CHAIN_NAME_KEYS = ['lora_name', 'lora']
CHAIN_STRENGTH_KEYS = ['strength_model', 'strength', 'lora_strength', 'model_strength', 'lora_model_strength', 'model_weight', 'lora_wt', 'weight']
CHAIN_CLIP_KEYS = ['strength_clip', 'clip_strength', 'lora_clip_strength', 'clip_weight']
STACK_STRENGTH_PREFIXES = ['strength', 'model_strength', 'wt', 'lora_wt', 'model_weight', 'model_str', 'strength_model', 'lora_strength', 'weight']
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
    for class_type, definition in (object_info or {}).items():
        if not isinstance(definition, dict):
            continue
        inputs = definition.get('input', {}) if isinstance(definition.get('input'), dict) else {}
        outputs = definition.get('output')
        # Semantic rule: Checkpoint/UNet loaders in ComfyUI MUST produce a MODEL output
        has_model_output = isinstance(outputs, list) and any(str(o).upper() == 'MODEL' for o in outputs)
        for group in (inputs.get('required') or {}, inputs.get('optional') or {}):
            for field, rule in group.items():
                kind = kinds.get(field)
                if not kind or not isinstance(rule, list) or not rule or not isinstance(rule[0], list):
                    continue
                if kind in ('checkpoints', 'unets'):
                    if NOT_MODEL.search(class_type):
                        continue
                    if isinstance(outputs, list) and not has_model_output:
                        continue
                for option in rule[0]:
                    if isinstance(option, str) and option and option != 'None':
                        if kind in ('checkpoints', 'unets', 'loras'):
                            if NOT_MODEL_FILE.search(option) or not MODEL_EXT.search(option):
                                continue
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
            if not isinstance(value, str) or re.search(r'text|prompt|positive|negative|wildcard', key, re.I):
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
            return [] if object_style else [k for k in node['inputs'] if any(k in (p+'_'+token, p+token, 'lora_'+token+'_'+p) for p in prefixes)]
        strength_paths, clip_paths, switch_paths = siblings(STACK_STRENGTH_PREFIXES), siblings(STACK_CLIP_PREFIXES), siblings(STACK_SWITCH_PREFIXES)
        slots.append({'index': int(token), 'slotToken': token, 'namePrefix': key[:match.start(2)], 'nameSuffix': key[match.end(2):], 'namePath': key, 'objectStyle': object_style,
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
    if not strength_path:
        return None
    passthrough = [k for k in PASSTHROUGH_KEYS if k in inputs]
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
    if not isinstance(node, dict) or not isinstance(node.get('inputs'), dict):
        return ''
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


def _stack_current_loras(workflow, lora):
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
            raise LibraryError('LoRA 强度必须是有限数字') from None
        if not math.isfinite(strength):
            raise LibraryError('LoRA 强度必须是有限数字')
        entry = {'name': name, 'strength': _round2(strength)}
        clip = raw.get('clip')
        if clip not in (None, ''):
            try:
                clip = float(clip)
            except (TypeError, ValueError):
                raise LibraryError('LoRA CLIP 强度必须是有限数字') from None
            if not math.isfinite(clip):
                raise LibraryError('LoRA CLIP 强度必须是有限数字')
            entry['clip'] = _round2(clip)
        if name in seen:
            out[next(i for i, l in enumerate(out) if l['name'] == name)] = entry
            continue
        seen.add(name)
        out.append(entry)
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
    chain = copy.deepcopy(lora['chain'])
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
        chain.append({**tail, 'nodeId': new_id})
    for i, d in enumerate(chain):
        node = workflow[d['nodeId']]
        if i < len(loras):
            l = loras[i]
            _write_field(workflow, d['nodeId'], d['namePath'], lora_display_name(l['name'], 'file'))
            if d['strengthPath']:
                _write_field(workflow, d['nodeId'], d['strengthPath'], l['strength'])
            if d['clipPath']:
                _write_field(workflow, d['nodeId'], d['clipPath'], l.get('clip', l['strength']))
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
    slots = copy.deepcopy(lora['slots'])
    if not slots:
        raise LibraryError('节点没有可识别的 LoRA 输入')
    object_style = slots[0]['objectStyle']
    if len(loras) > len(slots):
        if not object_style:
            raise LibraryError('LoRA 堆栈只有 %d 个位置，无法放下 %d 个 LoRA' % (len(slots), len(loras)))
        template = node['inputs'][slots[0]['namePath']]
        base, suffix = slots[0]['namePrefix'], slots[0]['nameSuffix']
        next_index = max(s['index'] for s in slots) + 1
        while len(slots) < len(loras):
            token = str(next_index).rjust(len(slots[0]['slotToken']), '0')
            path = base + token + suffix
            node['inputs'][path] = copy.deepcopy(template)
            slots.append({**slots[0], 'index': next_index, 'slotToken': token, 'namePath': path})
            next_index += 1
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
            _write_field(workflow, lora['nodeId'], slot['namePath'], lora_display_name(l['name'], 'file'))
            for key in slot['strengthPaths']:
                _write_field(workflow, lora['nodeId'], key, l['strength'])
            for key in slot['clipPaths']:
                _write_field(workflow, lora['nodeId'], key, l.get('clip', l['strength']))
            if slot['switchPath']:
                _write_field(workflow, lora['nodeId'], slot['switchPath'], on)
        elif slot['switchPath']:
            _write_field(workflow, lora['nodeId'], slot['switchPath'], off)
        else:
            _write_field(workflow, lora['nodeId'], slot['namePath'], 'None')
            for key in slot['strengthPaths']:
                _write_field(workflow, lora['nodeId'], key, 0)
            for key in slot['clipPaths']:
                _write_field(workflow, lora['nodeId'], key, 0)
    for count in ('lora_count', 'num_loras'):
        if count in node['inputs']:
            _write_field(workflow, lora['nodeId'], count, len(loras))


def describe_overrides(overrides):
    """Short human summary for task cards: model name and LoRA list."""
    clean = overrides if isinstance(overrides, dict) else {}
    parts = []
    if isinstance(clean.get('model'), str) and clean['model']:
        parts.append(lora_stem(clean['model']))
    if isinstance(clean.get('loras'), list):
        names = [lora_stem(l.get('name', '')) + ' ×' + number_text(l.get('strength', 1)) for l in clean['loras'] if isinstance(l, dict)]
        parts.append('LoRA · ' + (', '.join(names) if names else '无追加'))
    return ' · '.join(parts)


MODEL_INPUT = re.compile(r'^(model\d*|unet)$', re.I)


def info_hash(info):
    return hashlib.sha256(json.dumps(info or {}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _rules(node, info):
    inputs = (info or {}).get(node.get('class_type'), {}).get('input', {})
    return {**inputs.get('required', {}), **inputs.get('optional', {})}


class Graph:
    """Declared types first; without definitions only one-hop field semantics."""
    def __init__(self, workflow, info):
        self.wf, self.info = workflow, info or {}
        self.users = _consumer_index(workflow)
        self.blocked = set()
        for nid in _node_ids(workflow):
            inputs = workflow[nid]['inputs']
            def literal(value):
                if _is_link(value, workflow):
                    src = workflow.get(str(value[0]), {}).get('inputs', {})
                    if any(_is_link(v, workflow) for v in src.values()) or len(src) != 1:
                        return None
                    return next(iter(src.values()))
                return value
            for yes, no in [('on_true', 'on_false'), ('tt_value', 'ff_value'), ('true_input', 'false_input')]:
                if yes in inputs and no in inputs:
                    controls = [literal(v) for k, v in inputs.items() if k not in (yes, no)]
                    bools = [v for v in controls if type(v) is bool]
                    if len(bools) == 1:
                        self.blocked.add((nid, no if bools[0] else yes))
            selected = literal(inputs.get('select'))
            if type(selected) is int:
                for key in inputs:
                    match = re.fullmatch(r'input_?(\d+)', key)
                    if match and int(match[1]) != selected:
                        self.blocked.add((nid, key))
        # A branch shared by a live consumer must never be classified as dead.
        self.dead = set()
        for _ in workflow:
            added = {nid for nid, users in self.users.items() if users and all(
                (u['consumer'], u['key']) in self.blocked or u['consumer'] in self.dead for u in users)}
            if added <= self.dead:
                break
            self.dead |= added

    def output(self, nid, slot):
        outputs = self.info.get(self.wf.get(nid, {}).get('class_type'), {}).get('output', [])
        return str(outputs[slot]).upper() if 0 <= slot < len(outputs) else ''

    def edge(self, nid, user, kind='MODEL'):
        declared = self.output(nid, user['index'])
        if declared:
            return declared.endswith('MODEL') if kind == 'MODEL' else declared == kind
        key = user['key'].lower()
        return bool(MODEL_INPUT.fullmatch(key)) if kind == 'MODEL' else key in ('lora_stack', 'prev_lora')

    def model_node(self, nid):
        definition = self.info.get(self.wf[nid].get('class_type'))
        if definition is not None:
            return any(str(t).upper().endswith('MODEL') for t in definition.get('output', []))
        return any(self.edge(nid, u) for u in self.users.get(nid, []))

    def active(self, nid):
        if self.wf[nid].get('mode') in (2, 4):
            return False, '节点未启用，不在执行图中'
        if nid in self.dead:
            return False, 'LoRA 节点位于未启用的分支，默认不写入'
        if not any(self.edge(nid, u) or self.edge(nid, u, 'LORA_STACK') for u in self.users.get(nid, [])):
            return False, 'MODEL / LORA_STACK 输出没有消费者，默认不写入'
        return True, ''

    def reaches(self, start, end):
        seen, todo = set(), [start]
        while todo:
            nid = todo.pop()
            if nid in seen:
                continue
            seen.add(nid)
            for user in self.users.get(nid, []):
                if not self.edge(nid, user) or (user['consumer'], user['key']) in self.blocked:
                    continue
                if user['consumer'] == end:
                    return True
                todo.append(user['consumer'])
        return False


def trace_origin(workflow, link, object_info=None, sites=None):
    """Follow at most eight unambiguous STRING edges, never switches/concats."""
    seen = set()
    for _ in range(8):
        if not _is_link(link, workflow):
            break
        nid = str(link[0])
        if nid in seen or nid not in workflow:
            break
        seen.add(nid)
        node = workflow[nid]
        outputs = (object_info or {}).get(node.get('class_type'), {}).get('output', [])
        if link[1] < len(outputs) and outputs[link[1]] != 'STRING':
            return {'nodeId': nid, 'path': '', 'writable': False}
        if sites and nid in sites and sites[nid]['kind'] in ('object', 'syntax'):
            return {'nodeId': nid, 'path': sites[nid]['path'], 'writable': True}
        links = [(k, v) for k, v in node['inputs'].items() if _is_link(v, workflow)]
        if not links:
            strings = [(k, v) for k, v in node['inputs'].items() if isinstance(v, str)]
            return {'nodeId': nid, 'path': strings[0][0] if len(strings) == 1 else '', 'writable': len(strings) == 1}
        rules = _rules(node, object_info)
        # Only pure single-input forwarding nodes are transparent. A selector is not.
        if len(node['inputs']) != 1 or len(links) != 1:
            return {'nodeId': nid, 'path': '', 'writable': False}
        key, value = links[0]
        rule = rules.get(key, [])
        if not rule or rule[0] != 'STRING':
            return {'nodeId': nid, 'path': '', 'writable': False}
        link = value
    return {'nodeId': str(link[0]) if _is_link(link, workflow) else '', 'path': '', 'writable': False}


def _site(nid, workflow, model_ids):
    node = workflow[nid]
    obj = _mirror_path_for(node, workflow)
    slots = stack_slots(node, workflow)
    desc = chain_descriptor(nid, workflow)
    common = {'nodeId': nid}
    if obj:
        return {**common, 'kind': 'object', 'path': obj}
    if slots:
        return {**common, 'kind': 'stack', 'path': slots[0]['namePath'], 'slots': slots}
    if desc:
        return {**common, 'kind': 'embedded' if nid in model_ids else 'chain', 'path': desc['namePath'], 'chain': [desc]}
    for key, value in node['inputs'].items():
        if ('lora' in key.lower() and 'syntax' in key.lower()) or (isinstance(value, str) and '<lora:' in value):
            return {**common, 'kind': 'syntax', 'path': key}
    return None


def _pinned(site, wf):
    nid, kind, path = site['nodeId'], site['kind'], site['path']
    inputs = wf[nid]['inputs']
    if kind == 'object':
        raw = inputs[path]
        entries = raw if isinstance(raw, list) else raw['__value__']
        return [dict(name=e.get('name', e.get('lora')), strength=_num(e.get('strength', 1)),
                     **({'clip': _num(e['clipStrength'])} if e.get('clipStrength') not in (None, '') else {}))
                for e in entries if e.get('active') is not False and e.get('on') is not False and not _is_empty_name(e.get('name', e.get('lora')))]
    if kind == 'syntax':
        return parse_lora_syntax(inputs[path])['loras'] if isinstance(inputs[path], str) else []
    if kind in ('chain', 'embedded'):
        d = site['chain'][0]
        if _is_empty_name(d['value']):
            return []
        return [dict(name=d['value'], strength=d['strength'] if _is_number(d['strength']) else 1,
                     **({'clip': d['clip']} if _is_number(d['clip']) else {}))]
    return _stack_current_loras(wf, {'nodeId': nid})


def analyze(workflow, object_info=None, manual=None, legacy=None):
    wf = workflow or {}
    g = Graph(wf, object_info)
    issues, targets = [], []
    def issue(code, nid, text):
        issues.append({'level': 'warn', 'code': code, 'nodeId': nid, 'text': text})
    candidates = model_candidates(wf, object_info)
    for nid in _node_ids(wf):
        for key, value in wf[nid]['inputs'].items():
            if not STRONG_MODEL_KEYS.fullmatch(key) or not _is_link(value, wf):
                continue
            origin = trace_origin(wf, value, object_info)
            provider = wf.get(origin['nodeId'], {}).get('inputs', {})
            filenames = [(k, v) for k, v in provider.items() if isinstance(v, str) and MODEL_EXT.search(v)]
            if not origin['writable'] and not any(_is_link(v, wf) for v in provider.values()) and len(filenames) == 1:
                origin.update(path=filenames[0][0], writable=True)
            current = provider.get(origin['path'])
            if origin['writable'] and isinstance(current, str) and MODEL_EXT.search(current):
                candidates.append({'nodeId': origin['nodeId'], 'path': origin['path'], 'value': current,
                                   'sourceNodeId': nid, 'sourcePath': key, 'score': 6, 'title': _title(wf[nid])})
            else:
                targets.append({'key': f'{nid}:{key}', 'nodeId': nid, 'path': key, 'current': '',
                                'title': _title(wf[nid]), 'role': 'linked-unwritable', 'enabled': False,
                                'reason': '模型字段已连线，来源不是唯一字面量提供者'})
                issue('linked-unwritable', nid, targets[-1]['reason'])
    candidates.sort(key=lambda c: (-c['score'], _sort_key(c.get('sourceNodeId', c['nodeId']))))
    primary = None
    for c in candidates:
        nid = c.get('sourceNodeId', c['nodeId'])
        if any(t['key'] == c['nodeId']+':'+c['path'] for t in targets):
            continue
        if not g.model_node(nid):
            issue('accessory-weight', nid, '附属权重，不进模型映射：'+c['path'])
            continue
        key = c['nodeId']+':'+c['path']
        if any(t['key'] == key for t in targets):
            continue
        normalized = c['value'].replace('\\', '/').lower()
        role = 'primary' if primary is None else 'same' if primary == normalized else 'other'
        if primary is None:
            primary = normalized
        targets.append({**c, 'key': key, 'current': c['value'], 'role': role, 'enabled': role != 'other'})
    model_ids = {c.get('sourceNodeId', c['nodeId']) for c in candidates}
    sites = {nid: s for nid in _node_ids(wf) if (s := _site(nid, wf, model_ids))}
    for entry in manual or []:
        nid, path = str(entry.get('nodeId', '')), entry.get('path', '')
        if nid not in wf or path not in wf[nid]['inputs']:
            issue('manual-missing', nid, '手动指定的字段不在工作流中'); continue
        value = wf[nid]['inputs'][path]
        if _is_link(value, wf):
            issue('manual-linked', nid, '手动字段已连线，不能安全写入'); continue
        if re.search(r'lora', path, re.I) and isinstance(value, str) and '<lora:' not in value and 'syntax' not in path:
            inputs = wf[nid]['inputs']
            token = re.search(r'\d+', path)
            token = token.group() if token else ''
            strength = _first_key(inputs, CHAIN_STRENGTH_KEYS + [f'strength_{token}', f'lora_{token}_strength'])
            sites[nid] = {'nodeId': nid, 'path': path, 'kind': 'chain' if path in CHAIN_NAME_KEYS and nid not in model_ids and chain_descriptor(nid, wf) else 'embedded', 'manual': True,
                          'chain': [{'nodeId': nid, 'namePath': path, 'strengthPath': strength,
                                     'clipPath': _first_key(inputs, CHAIN_CLIP_KEYS), 'value': value,
                                     'strength': inputs.get(strength), 'clip': None, 'passthrough': [k for k in PASSTHROUGH_KEYS if k in inputs]}]}
        elif isinstance(value, str) and MODEL_EXT.search(value):
            key = nid+':'+path
            if not any(t['key'] == key for t in targets):
                targets.append({'key': key, 'nodeId': nid, 'path': path, 'title': _title(wf[nid]),
                                'current': value, 'role': 'other', 'enabled': True, 'manual': True})
        elif isinstance(value, str):
            sites[nid] = {'nodeId': nid, 'path': path, 'kind': 'syntax', 'manual': True}
        elif _mirror_path_for({'inputs': {path: value}}, wf):
            sites[nid] = {'nodeId': nid, 'path': path, 'kind': 'object', 'manual': True}
        else:
            issue('manual-unwritable', nid, '手动字段的值形态不可写')
    # Self-contained loaders own their LoRA input; upstream stack providers stay read-only.
    suppressed = set()
    for nid, s in sites.items():
        if s['kind'] not in ('object', 'embedded'):
            continue
        todo = [str(v[0]) for k, v in wf[nid]['inputs'].items() if k in ('lora_stack', 'prev_lora') and _is_link(v, wf)]
        while todo:
            src = todo.pop()
            if src in suppressed or src not in wf:
                continue
            suppressed.add(src)
            todo.extend(str(v[0]) for k, v in wf[src]['inputs'].items() if k in ('lora_stack', 'prev_lora') and _is_link(v, wf))
    groups = {}
    for nid, site in sites.items():
        if nid in suppressed:
            issue('single-entry', nid, '下游加载器有自有 LoRA 参数，上游堆栈只读'); continue
        active, warn = g.active(nid)
        if site['kind'] == 'syntax' and not g.model_node(nid) and not site.get('manual'):
            # Passive metadata / prompt fields must never be parameter application sites.
            continue
        value = wf[nid]['inputs'][site['path']]
        origin, writer = None, site
        if site['kind'] == 'syntax' and _is_link(value, wf):
            origin = trace_origin(wf, value, object_info, sites)
            if origin['writable'] and origin['nodeId'] in sites:
                writer = sites[origin['nodeId']]
                key = 'origin:'+writer['nodeId']+':'+writer['path']
            else:
                key = 'direct:'+str(value[0])+':'+str(value[1])
                origin = None
        else:
            key = 'origin:'+nid+':'+site['path']
        if key not in groups:
            groups[key] = {'key': key, 'kind': writer['kind'], 'origin': {'nodeId': writer['nodeId'], 'path': writer['path']} if origin or writer['kind'] != 'syntax' or not _is_link(value, wf) else None,
                           'writer': copy.deepcopy(writer), 'sites': [], 'pinned': _pinned(writer, wf),
                           'active': False, 'warn': '', 'series': '', 'append': True}
        group = groups[key]
        group['sites'].append({'nodeId': nid, 'path': site['path'], 'active': active, 'reason': warn})
        group['active'] |= active
        if warn:
            issue('dead-branch' if nid in g.dead else 'inactive-site', nid, warn)
    groups = list(groups.values())
    for nid in _node_ids(wf):
        if nid not in sites and any(g.edge(nid, u, 'LORA_STACK') for u in g.users.get(nid, [])):
            issue('readonly-origin', nid, 'LoRA 堆栈来源没有可写参数，只读且不成组')
    for group in groups:
        if len(group['sites']) > 1 and group.get('origin'):
            group['sites'] = [s for s in group['sites'] if s['active'] or s['nodeId'] != group['origin']['nodeId']]
            issues[:] = [i for i in issues if not (i['code'] == 'inactive-site' and i['nodeId'] == group['origin']['nodeId'])]
        group['enabled'] = group['active']
        group['warn'] = '' if group['active'] else '无活跃应用点，默认不写入'
        # Declarative metadata for both executors: no browser-side discovery.
        writer = group['writer']; node = wf[writer['nodeId']]
        writer['textPaths'] = [k for k, v in node['inputs'].items() if isinstance(v, str) and (k == 'text' or '<lora:' in v)] if writer['kind'] == 'object' else []
        ranges = []
        rules = _rules(node, object_info)
        paths = [d.get(k) for d in writer.get('chain', []) for k in ('strengthPath', 'clipPath')]
        paths += [k for s in writer.get('slots', []) for k in s['strengthPaths']+s['clipPaths']]
        for path in filter(None, paths):
            rule = rules.get(path, [])
            metadata = rule[1] if len(rule) > 1 and isinstance(rule[1], dict) else {}
            ranges.append({'min': metadata.get('min', -5), 'max': metadata.get('max', 5)})
        writer['range'] = {'min': max([r['min'] for r in ranges] or [-5]), 'max': min([r['max'] for r in ranges] or [5])}
    # Series annotation and append only at terminal sites; branches each have a terminal.
    for i, group in enumerate(groups):
        downstream = [other for other in groups if other is not group and other['active'] and group['active'] and any(
            g.reaches(a['nodeId'], b['nodeId']) for a in group['sites'] for b in other['sites'])]
        group['upstreamKeys'] = [other['key'] for other in groups if other is not group and other['active'] and any(g.reaches(a['nodeId'], b['nodeId']) for a in other['sites'] for b in group['sites'])]
        group['append'] = not downstream
        upstream = [j for j, other in enumerate(groups) if any(g.reaches(a['nodeId'], b['nodeId']) for a in other['sites'] for b in group['sites'])]
        group['series'] = 'S'+str(min([i]+upstream)+1)
    def drives_sampler(target):
        nid = target.get('sourceNodeId', target['nodeId'])
        first = [u['consumer'] for u in g.users.get(nid, []) if g.edge(nid, u)]
        reachable = first + [u['consumer'] for n in first for u in g.users.get(n, []) if g.edge(n, u)]
        return any(any(k in wf[n]['inputs'] for k in ('latent_image', 'samples', 'latent')) for n in reachable)
    pair_target = next((t for t in targets if t['role'] == 'other' and drives_sampler(t)), None)
    paired = pair_target is not None
    if pair_target:
        pair_target['pairedSelector'] = True
    synth = None
    if not any(group['active'] for group in groups):
        main = next((t for t in targets if t['role'] == 'primary'), None)
        if main:
            nid = main.get('sourceNodeId', main['nodeId'])
            path = main.get('sourcePath', main['path'])
            outputs = (object_info or {}).get(wf[nid].get('class_type'), {}).get('output', [])
            if STRONG_MODEL_KEYS.fullmatch(path) and 'MODEL' in outputs:
                clip_slot = outputs.index('CLIP') if 'CLIP' in outputs else None
                clip_used = clip_slot is not None and any(u['index'] == clip_slot and any(k in wf[u['consumer']]['inputs'] for k in ('text', 'prompt')) for u in g.users.get(nid, []))
                synth = {'after': {'nodeId': nid, 'modelSlot': outputs.index('MODEL'), 'clipSlot': clip_slot if clip_used else None},
                         'classType': 'LoraLoader' if clip_used else 'LoraLoaderModelOnly'}
                rules = _rules({'class_type': synth['classType']}, object_info)
                ranges = [rule[1] for key, rule in rules.items() if key in ('strength_model', 'strength_clip') and len(rule) > 1 and isinstance(rule[1], dict)]
                synth['range'] = {'min': max([r.get('min', -5) for r in ranges] or [-5]), 'max': min([r.get('max', 5) for r in ranges] or [5])}
    enabled = any(group['active'] for group in groups) or synth is not None
    reason = '' if enabled else '此工作流没有可用的 LoRA 应用点，且加载器不是标准类型（缺少声明时请同步节点定义）'
    if reason:
        issue('no-lora-site', '', reason)
    plan = {'version': 3, 'analyzedAt': datetime.now(timezone.utc).isoformat(), 'objectInfoHash': info_hash(object_info),
            'workflowHash': info_hash(wf), 'manual': copy.deepcopy(manual or []),
            'model': {'paired': paired, 'targets': targets},
            'lora': {'enabled': enabled, 'reason': reason, 'groups': groups, 'synth': synth}, 'issues': issues}
    _migrate(plan, legacy or {})
    return plan


def _migrate(plan, legacy):
    oldplan = legacy.get('plan', {})
    if plan['lora']['synth'] and (oldplan.get('lora', {}).get('synth') or {}).get('enabled') is False:
        plan['lora']['synth']['enabled'] = False
    if plan['lora']['synth'] and legacy.get('lora', {}).get('mode') == 'off':
        plan['lora']['synth']['enabled'] = False
    for kind, collection in [('model', 'targets'), ('lora', 'groups')]:
        previous = {x['key']: x for x in oldplan.get(kind, {}).get(collection, [])}
        current_keys = {x['key'] for x in plan[kind][collection]}
        for key in previous.keys() - current_keys:
            plan['issues'].append({'level': 'warn', 'code': 'stale-target', 'nodeId': previous[key].get('nodeId', ''), 'text': '旧的计划目标不在工作流中：'+key})
        for entry in plan[kind][collection]:
            if entry['key'] in previous:
                entry['enabled'] = previous[entry['key']].get('enabled', entry['enabled'])
                if 'disabled' in previous[entry['key']]:
                    entry['disabled'] = previous[entry['key']]['disabled']
        old = legacy.get(kind, {})
        if old.get('enabled') is False or old.get('mode') == 'off':
            for entry in plan[kind][collection]:
                entry['enabled'] = False
        if old.get('auto') is False and old.get('nodeId'):
            match = [e for e in plan[kind][collection] if (e.get('nodeId') == str(old['nodeId']) and e.get('path') == old.get('path')) or any(s['nodeId'] == str(old['nodeId']) for s in e.get('sites', []))]
            if match:
                for entry in plan[kind][collection]:
                    entry['enabled'] = entry in match and old.get('enabled') is not False and old.get('mode') != 'off'
            else:
                for entry in plan[kind][collection]:
                    entry['enabled'] = False
                plan['issues'].append({'level': 'warn', 'code': 'legacy-missing', 'nodeId': str(old['nodeId']), 'text': '旧的自定义目标不在工作流中'})


def ensure_plan(workflow, slots=None, object_info=None):
    slots = slots or {}
    plan = slots.get('plan', slots if slots.get('version') == 3 else {})
    if plan.get('version') != 3 or plan.get('objectInfoHash') != info_hash(object_info) or plan.get('workflowHash') != info_hash(workflow):
        return analyze(workflow, object_info, plan.get('manual'), slots)
    return copy.deepcopy(plan)


def normalize_overrides(overrides):
    if not isinstance(overrides, dict):
        raise LibraryError('模型 / LoRA 覆盖必须是对象')
    clean = {}
    def filename(value):
        if not isinstance(value, str) or not value.strip() or len(value) > 300 or re.search(r'[<>\x00-\x1f]', value):
            raise LibraryError('模型名称无效')
        return value.strip()
    model = overrides.get('model')
    if isinstance(model, dict):
        clean['model'] = {str(k): filename(v) for k, v in model.items()}
    elif model not in (None, ''):
        clean['model'] = filename(model)
    if 'loras' in overrides:
        clean['loras'] = normalize_loras(overrides['loras'])
    for key in ('unpin', 'disabled'):
        if key in overrides:
            values = overrides[key]
            if not isinstance(values, list) or not all(isinstance(v, str) and len(v) <= 500 for v in values):
                raise LibraryError(key+' 必须是字符串数组')
            clean[key] = list(dict.fromkeys(values))
    return clean


def _name_key(name):
    return strip_extension(name.replace('\\', '/').lower())


def _merged(pinned, additions, unpin):
    unpin_keys = {_name_key(u) for u in unpin}
    result = {_name_key(x['name']): copy.deepcopy(x) for x in pinned if _name_key(x['name']) not in unpin_keys}
    for item in additions:
        result[_name_key(item['name'])] = copy.deepcopy(item)
    return list(result.values())


def _write_object(wf, writer, loras):
    node = wf[writer['nodeId']]; path = writer['path']
    raw = node['inputs'][path]
    if _is_link(raw, wf) or not isinstance(raw, (dict, list)) or isinstance(raw, dict) and not isinstance(raw.get('__value__'), list):
        raise LibraryError('LoRA 对象字段已连线或形态已变化，请重新分析')
    wrapped = isinstance(raw, dict)
    entries = raw['__value__'] if wrapped else raw
    if any(not isinstance(e, dict) for e in entries):
        raise LibraryError('LoRA 对象条目无效，请重新分析')
    template = entries[0] if entries else {'name': '', 'strength': 1, 'active': True, 'clipStrength': 1}
    values = []
    for lora in loras:
        e = copy.deepcopy(template)
        e['lora' if 'lora' in e and 'name' not in e else 'name'] = lora['name']
        e.update(strength=lora['strength'], active=True)
        if 'on' in e:
            e['on'] = True
        if 'clipStrength' in e:
            e['clipStrength'] = lora.get('clip', lora['strength'])
        values.append(e)
    node['inputs'][path] = {**raw, '__value__': values} if wrapped else values
    for text_path in writer.get('textPaths', []):
        node['inputs'][text_path] = ' '.join(format_tag(l, 'path') for l in loras)


def apply(workflow, plan, overrides, object_info=None, positive=None):
    """Execute a v3 plan on an in-memory copy. Legacy callers are analyzed in Python."""
    plan = plan or {}
    plan = plan.get('plan', plan)
    if plan.get('version') != 3:
        plan = analyze(workflow, object_info, legacy=plan)
    clean = normalize_overrides(overrides)
    result, notices, writes = copy.deepcopy(workflow or {}), [], []
    disabled = set(clean.get('disabled', []))
    model = clean.get('model')
    known = {t['key'] for t in plan['model']['targets']}
    if isinstance(model, dict) and set(model) - known:
        raise LibraryError('模型目标不在工作流中')
    for target in plan['model']['targets']:
        key = target['key']
        selected = target.get('enabled', target['role'] in ('primary', 'same')) or (isinstance(model, dict) and key in model)
        value = model.get(key) if isinstance(model, dict) else model
        if not value:
            continue
        if key in disabled or target.get('disabled') or not selected or target['role'] == 'linked-unwritable':
            notices.append('跳过模型 '+key+'：'+target.get('reason', '未勾选')); continue
        nid, path = target['nodeId'], target['path']
        source = result.get(target.get('sourceNodeId', nid), {})
        options = _field_enum(source, target.get('sourcePath', path), object_info)
        norm_val = str(value).replace('\\', '/').lower()
        if options is not None and not any(str(o).replace('\\', '/').lower() == norm_val for o in options):
            raise LibraryError('模型 '+value+' 不在 '+key+' 的枚举列表中')
        _write_field(result, nid, path, value)
        writes.append({'kind': 'model', 'key': key, 'nodeId': nid, 'path': path, 'value': value})
        notices.append('写入模型 '+key+' → '+value)
    if model and not any(w['kind'] == 'model' for w in writes):
        raise LibraryError('当前工作流没有可写入的模型映射（全部跳过）')
    if 'loras' in clean or clean.get('unpin'):
        groups = copy.deepcopy(plan['lora']['groups'])
        if clean.get('loras') and plan['lora'].get('synth') and plan['lora']['synth'].get('enabled', True) and 'synth:'+plan['lora']['synth']['after']['nodeId'] not in disabled and not any(g.get('enabled', g['active']) and g['key'] not in disabled for g in groups):
            synth = plan['lora']['synth']; after = synth['after']; src = after['nodeId']
            n, nid = 1, src+':lora'
            while nid in result:
                nid = f"{src}:lora{n}"
                n += 1
            inputs = {'model': [src, after['modelSlot']], 'lora_name': '', 'strength_model': 1}
            passthrough = ['model']
            if after['clipSlot'] is not None:
                inputs.update(clip=[src, after['clipSlot']], strength_clip=1); passthrough.append('clip')
            for user in _consumer_index(result).get(src, []):
                if user['index'] == after['modelSlot']:
                    result[user['consumer']]['inputs'][user['key']] = [nid, 0]
                elif after['clipSlot'] is not None and user['index'] == after['clipSlot']:
                    result[user['consumer']]['inputs'][user['key']] = [nid, 1]
            result[nid] = {'class_type': synth['classType'], 'inputs': inputs}
            desc = {'nodeId': nid, 'namePath': 'lora_name', 'strengthPath': 'strength_model', 'clipPath': 'strength_clip' if len(passthrough) == 2 else '', 'passthrough': passthrough}
            groups.append({'key': 'synth:'+src, 'kind': 'chain', 'writer': {'nodeId': nid, 'chain': [desc], 'range': synth.get('range', {'min': -5, 'max': 5})},
                           'active': True, 'enabled': True, 'append': True, 'pinned': [], 'sites': [{'nodeId': nid, 'path': 'lora_name'}]})
        wrote = False
        unpin_keys = {_name_key(u) for u in clean.get('unpin', [])}
        for group in groups:
            if group['key'] in disabled or not group.get('enabled', group['active']):
                notices.append('跳过 LoRA '+group['key']+'：'+(group.get('warn') or '未勾选')); continue
            local_names = {_name_key(l['name']) for l in group['pinned']}
            upstream_names = {_name_key(l['name']) for other in groups if other['key'] in group.get('upstreamKeys', []) for l in other['pinned'] if _name_key(l['name']) not in unpin_keys}
            additions = [l for l in clean.get('loras', []) if _name_key(l['name']) in local_names or (group.get('append', True) and _name_key(l['name']) not in upstream_names)]
            final = _merged(group['pinned'], additions, clean.get('unpin', []))
            if final == group['pinned']:
                # Still count this as a valid destination for an empty user addition.
                wrote = True
                continue
            writer = group['writer']; bounds = writer.get('range', {'min': -5, 'max': 5})
            for item in final:
                for value in [item['strength']] + ([item['clip']] if 'clip' in item else []):
                    if not _is_number(value) or not math.isfinite(value) or not bounds['min'] <= value <= bounds['max']:
                        raise LibraryError('LoRA 强度必须在 %s 到 %s 之间' % (bounds['min'], bounds['max']))
            for site in group['sites']:
                if site.get('active') is False and group['active']:
                    notices.append('跳过 LoRA 站点 '+site['nodeId']+':'+site['path']+'：'+site.get('reason', '不活跃'))
            kind = group['kind']
            if kind == 'chain':
                _apply_chain(result, writer, final, notices)
            elif kind == 'stack':
                _apply_stack(result, writer, final)
            elif kind == 'embedded':
                if len(final) > 1:
                    raise LibraryError('此工作流的加载器最多 1 个 LoRA')
                d = writer['chain'][0]
                if not final and not d['strengthPath']:
                    raise LibraryError('内嵌 LoRA 没有强度字段，无法安全禁用')
                if final:
                    _write_field(result, writer['nodeId'], writer['path'], final[0]['name'])
                for path, clip in [(d['strengthPath'], False), (d['clipPath'], True)]:
                    if path:
                        _write_field(result, writer['nodeId'], path, (final[0].get('clip', final[0]['strength']) if clip else final[0]['strength']) if final else 0)
            elif kind == 'object':
                _write_object(result, writer, final)
            elif kind == 'syntax':
                destinations = [group['origin']] if group.get('origin') else group['sites']
                for site in destinations:
                    if site.get('active') is False and group['active']:
                        continue
                    node = result[site['nodeId']]
                    if _is_link(node['inputs'].get(site['path']), result):
                        node['inputs'][site['path']] = ''
                    _apply_syntax(result, {**site, 'nameFormat': 'path', 'placement': 'append', 'mirror': False}, final, notices)
            else:
                raise LibraryError('未知 LoRA 写入形态：'+kind)
            wrote = True
            if not group['active']:
                notices.append('手动启用不活跃 LoRA 组 '+group['key'])
            writes.append({'kind': 'lora', 'key': group['key'], 'origin': group.get('origin'), 'sites': [s for s in group['sites'] if s.get('active') is not False or not group['active']], 'loras': final})
            notices.append('写入 LoRA '+group['key']+' → '+', '.join(s['nodeId']+':'+s['path'] for s in group['sites'] if s.get('active') is not False or not group['active']))
        if clean.get('loras') and not wrote:
            raise LibraryError(plan['lora'].get('reason') or '没有启用的 LoRA 应用点')
    return {'workflow': result, 'notices': notices, 'writes': writes, 'slots': {'plan': plan}, 'plan': plan, 'overrides': clean}


def current_model(workflow, slots):
    plan = (slots or {}).get('plan', slots or {})
    return next((t['current'] for t in plan.get('model', {}).get('targets', []) if t['role'] == 'primary'), '')


def current_loras(workflow, slots):
    plan = (slots or {}).get('plan', slots or {})
    return _merged([x for g in plan.get('lora', {}).get('groups', []) for x in g['pinned']], [], [])
