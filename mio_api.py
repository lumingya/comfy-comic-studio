"""Mio external API v1. Deliberately separate from the private browser API.

Only explicit DTOs cross this boundary. No config/queue overwrite endpoint.
The stdlib-only handler is also usable by a future worker or plugin host.
"""
import copy
import hmac
import json
import math
import os
import threading
import urllib.parse
import uuid

VERSION = '1.0.0'
GENERATION_SLOT = threading.BoundedSemaphore(1)


class ApiError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def capabilities():
    return {'name': 'Mio', 'version': VERSION, 'apiVersion': 'v1',
            'providers': ['comfyui', 'novelai', 'openai'],
            'operations': ['read_storyboards', 'read_albums', 'read_providers', 'generate_image', 'read_asset'],
            'generationProviders': ['novelai', 'openai'],
            'generationMode': 'synchronous', 'maxConcurrentExternalGenerations': 1,
            'browserQueueIntegration': False, 'webhooks': False,
            'notes': 'ComfyUI execution and album/queue mutations currently belong to the browser workspace.'}


def provider_list(config):
    settings = config.get('uiConfig', {}).get('comfyStudio', {}).get('settings', {})
    profiles = settings.get('imageGeneration', {}).get('profiles', [])
    # URLs and arbitrary config extensions may contain credentials. Never return them.
    return [{k: p.get(k) for k in ('id', 'title', 'provider', 'model', 'protocol') if k in p}
            for p in profiles if isinstance(p, dict)]


def list_resources(config, kind, query):
    try:
        limit = int(query.get('limit', ['50'])[0])
        offset = int(query.get('offset', ['0'])[0])
    except (ValueError, TypeError):
        raise ApiError(400, 'invalid_pagination', 'limit and offset must be integers') from None
    if not 1 <= limit <= 100 or offset < 0:
        raise ApiError(400, 'invalid_pagination', 'limit: 1..100; offset: 0 or greater')
    source = config.get('templates' if kind == 'storyboards' else 'savedGalleries', [])
    fields = ('id', 'title', 'description', 'projectId') if kind == 'storyboards' else ('id', 'title', 'projectId', 'status', 'totalSteps', 'generatedSteps', 'updatedAt')
    data = []
    for item in source[offset:offset + limit]:
        obj = {key: item[key] for key in fields if key in item}
        if kind == 'storyboards':
            obj['frames'] = [{key: f[key] for key in ('id', 'name', 'prompt', 'negative', 'caption', 'width', 'height', 'steps', 'cfg', 'seed', 'denoise') if key in f}
                             for f in item.get('frames', [])]
        # sourceSnapshot may contain old keys or upstream workflows: never expose it.
        data.append(obj)
    return {'items': data, 'total': len(source), 'limit': limit, 'offset': offset}


def generation_payload(body, config):
    allowed = {'providerId', 'config', 'apiKey', 'prompt', 'negative', 'frame', 'source'}
    if set(body) - allowed:
        raise ApiError(400, 'unknown_field', 'Unknown generation field')
    if ('providerId' in body) == ('config' in body):
        raise ApiError(400, 'invalid_provider', 'Supply exactly one of providerId or config')
    if 'providerId' in body:
        profiles = config.get('uiConfig', {}).get('comfyStudio', {}).get('settings', {}).get('imageGeneration', {}).get('profiles', [])
        profile = next((p for p in profiles if p.get('id') == body['providerId']), None)
        if not profile:
            raise ApiError(404, 'provider_not_found', 'Save the provider in the workspace first, or pass config')
    else:
        profile = body['config']
    if not isinstance(profile, dict) or profile.get('provider') not in ('novelai', 'openai'):
        raise ApiError(400, 'unsupported_provider', 'v1 generation supports novelai and openai; ComfyUI uses the browser queue')
    allowed_config = {'provider', 'baseUrl', 'model', 'protocol', 'size', 'quality', 'sampler', 'id', 'title', 'sendSize', 'sendQuality', 'keyMode', 'keyId'}
    if 'config' in body and set(profile) - allowed_config:
        raise ApiError(400, 'unknown_field', 'Unknown config field')
    profile = {k: copy.deepcopy(v) for k, v in profile.items() if k in allowed_config}
    if any(not isinstance(v, bool) if k in ('sendSize', 'sendQuality') else not isinstance(v, str) for k, v in profile.items()):
        raise ApiError(400, 'invalid_config', 'Config values must be strings; sendSize/sendQuality must be booleans')
    if profile.get('keyMode', 'environment') not in ('none', 'stored', 'environment'):
        raise ApiError(400, 'invalid_config', 'Unsupported authentication mode')
    if profile.get('protocol', 'images') not in ('images', 'chat'):
        raise ApiError(400, 'invalid_protocol', 'protocol must be images or chat')
    prompt = body.get('prompt')
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 100000:
        raise ApiError(400, 'invalid_prompt', 'prompt must contain 1..100000 characters')
    for key in ('negative', 'apiKey', 'source'):
        if key in body and not isinstance(body[key], str):
            raise ApiError(400, 'invalid_field', key + ' must be a string')
    frame = body.get('frame', {})
    if not isinstance(frame, dict) or set(frame) - {'width', 'height', 'steps', 'cfg', 'seed', 'denoise'}:
        raise ApiError(400, 'invalid_frame', 'Unknown frame parameter')
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in frame.values()):
        raise ApiError(400, 'invalid_frame', 'Frame parameters must be numbers')
    if 'apiKey' in body and not body['apiKey']:
        profile['keyMode'] = 'none'
    return {'config': profile, 'key': body.get('apiKey', ''), 'prompt': prompt,
            'negative': body.get('negative', ''), 'frame': frame, 'source': body.get('source'),
            'albumId': 'external'}


def openapi():
    response = {'description': 'JSON envelope: data or error, with requestId', 'content': {'application/json': {'schema': {'type': 'object'}}}}
    paths = {}
    for path, summary in [('health', 'API health and version'), ('capabilities', 'Discover supported operations'), ('providers', 'List saved provider identifiers, without credentials'), ('storyboards', 'Read storyboard DTOs'), ('albums', 'Read album metadata'), ('assets', 'Read a local generated asset as a data URL'), ('openapi.json', 'Read this specification')]:
        op = {'summary': summary, 'responses': {'200': response, '401': response, '503': response}}
        if path in ('storyboards', 'albums'):
            op['parameters'] = [{'name': 'limit', 'in': 'query', 'schema': {'type': 'integer', 'minimum': 1, 'maximum': 100, 'default': 50}}, {'name': 'offset', 'in': 'query', 'schema': {'type': 'integer', 'minimum': 0, 'default': 0}}]
        if path == 'assets':
            op['parameters'] = [{'name': 'path', 'in': 'query', 'required': True, 'schema': {'type': 'string', 'pattern': '^/images/'}}]
        paths['/api/v1/' + path] = {'get': op}
    paths['/api/v1/images/generations'] = {'post': {'summary': 'Generate one image synchronously; no automatic retry and no browser queue mutation',
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'$ref': '#/components/schemas/GenerationRequest'}}}},
        'responses': {str(code): response for code in (200, 400, 401, 403, 404, 413, 429, 502, 503)}}}
    spec = {'openapi': '3.1.0', 'info': {'title': 'Mio external API', 'version': VERSION},
            'security': [{'bearerAuth': []}], 'paths': paths,
            'components': {'securitySchemes': {'bearerAuth': {'type': 'http', 'scheme': 'bearer'}}, 'schemas': {
                'GenerationRequest': {'type': 'object', 'additionalProperties': False, 'required': ['prompt'],
                    'oneOf': [{'required': ['providerId'], 'not': {'required': ['config']}}, {'required': ['config'], 'not': {'required': ['providerId']}}],
                    'properties': {'providerId': {'type': 'string'}, 'config': {'$ref': '#/components/schemas/ProviderConfig'},
                        'apiKey': {'type': 'string', 'writeOnly': True}, 'prompt': {'type': 'string', 'minLength': 1, 'maxLength': 100000},
                        'negative': {'type': 'string'}, 'source': {'type': 'string', 'description': 'PNG, JPEG or WebP base64 data URL'},
                        'frame': {'type': 'object', 'additionalProperties': False, 'properties': {key: {'type': 'number'} for key in ('width', 'height', 'steps', 'cfg', 'seed', 'denoise')}}}},
                'ProviderConfig': {'type': 'object', 'additionalProperties': False, 'required': ['provider', 'baseUrl', 'model'],
                    'properties': {**{key: {'type': 'string'} for key in ('baseUrl', 'model', 'size', 'quality', 'sampler', 'id', 'title')},
                        'provider': {'enum': ['novelai', 'openai']}, 'protocol': {'enum': ['images', 'chat']}}}}}}

    schemas = spec['components']['schemas']
    props = schemas['ProviderConfig']['properties']
    props.update(sendSize={'type': 'boolean'}, sendQuality={'type': 'boolean'}, keyId={'type': 'string'}, keyMode={'enum': ['none', 'stored', 'environment']})
    schemas['ErrorEnvelope'] = {'type': 'object', 'required': ['error', 'requestId'], 'properties': {
        'requestId': {'type': 'string'}, 'error': {'type': 'object', 'required': ['code', 'message'],
        'properties': {'code': {'type': 'string'}, 'message': {'type': 'string'}}}}}
    schemas['Provider'] = {'type': 'object', 'properties': {key: {'type': 'string'} for key in ('id', 'title', 'provider', 'model', 'protocol')}}
    schemas['Album'] = {'type': 'object', 'properties': {**{key: {'type': 'string'} for key in ('id', 'title', 'projectId', 'status')},
        **{key: {'type': 'number'} for key in ('totalSteps', 'generatedSteps', 'updatedAt')}}}
    schemas['Storyboard'] = {'type': 'object', 'properties': {**{key: {'type': 'string'} for key in ('id', 'title', 'projectId', 'description')},
        'frames': {'type': 'array', 'items': {'type': 'object', 'properties': {
            **{key: {'type': 'string'} for key in ('id', 'name', 'prompt', 'negative', 'caption')},
            **{key: {'type': 'number'} for key in ('width', 'height', 'steps', 'cfg', 'seed', 'denoise')}}}}}}
    schemas['GenerationResult'] = {'type': 'object', 'required': ['image', 'provider', 'offlineFallback', 'assetEndpoint'],
        'properties': {'image': {'type': 'string'}, 'provider': {'enum': ['novelai', 'openai']},
            'offlineFallback': {'const': False}, 'assetEndpoint': {'type': 'string'}}}
    schemas['Capabilities'] = {'type': 'object', 'properties': {
        **{key: {'type': 'string'} for key in ('name', 'version', 'apiVersion', 'generationMode', 'notes')},
        **{key: {'type': 'array', 'items': {'type': 'string'}} for key in ('providers', 'operations', 'generationProviders')},
        'browserQueueIntegration': {'type': 'boolean'}, 'webhooks': {'type': 'boolean'}, 'maxConcurrentExternalGenerations': {'type': 'integer'}}}
    def ref(name):
        return {'$ref': '#/components/schemas/' + name}
    def listing(name):
        return {'type': 'object', 'required': ['items', 'total', 'limit', 'offset'], 'properties': {
            'items': {'type': 'array', 'items': ref(name)}, **{key: {'type': 'integer'} for key in ('total', 'limit', 'offset')}}}
    result_schemas = {
        'health': {'type': 'object', 'properties': {key: {'type': 'string'} for key in ('status', 'name', 'version')}},
        'capabilities': ref('Capabilities'), 'providers': {'type': 'array', 'items': ref('Provider')},
        'storyboards': listing('Storyboard'), 'albums': listing('Album'),
        'assets': {'type': 'object', 'required': ['dataUrl'], 'properties': {'dataUrl': {'type': 'string'}}},
        'images/generations': ref('GenerationResult')}
    for path, methods in spec['paths'].items():
        for method, operation in methods.items():
            route = path.removeprefix('/api/v1/')
            operation['operationId'] = method + '_' + route.replace('/', '_').replace('.', '_')
            success_schema = {'type': 'object'} if route == 'openapi.json' else {
                'type': 'object', 'required': ['data', 'requestId'], 'properties': {
                    'data': result_schemas[route], 'requestId': {'type': 'string'}}}
            operation['responses'] = {str(code): {'description': 'Success' if code == 200 else 'API error',
                'content': {'application/json': {'schema': success_schema if code == 200 else ref('ErrorEnvelope')}}}
                for code in ((200, 400, 401, 403, 404, 413, 429, 500, 502, 503) if method == 'post' else (200, 400, 401, 403, 404, 500, 503))}
    return spec


def handle(handler, backend):
    """Return True only for the versioned namespace. Token required on EVERY route."""
    parsed = urllib.parse.urlparse(handler.path)
    if not (parsed.path == '/api/v1' or parsed.path.startswith('/api/v1/')):
        return False
    request_id = 'req_' + uuid.uuid4().hex
    def send(status, data=None, error=None):
        handler.send_json(status, {'error': error, 'requestId': request_id} if error else {'data': data, 'requestId': request_id})
    try:
        token = os.environ.get('MIO_API_TOKEN', '')
        if len(token) < 32:
            raise ApiError(503, 'api_disabled', 'Set MIO_API_TOKEN to at least 32 characters to enable the external API')
        auth = handler.headers.get('Authorization', '')
        if not hmac.compare_digest(auth.encode(), ('Bearer ' + token).encode()):
            raise ApiError(401, 'unauthorized', 'A valid Mio Bearer token is required')
        if not handler.is_origin_allowed():
            raise ApiError(403, 'origin_denied', 'Origin is not allowed')
        query = urllib.parse.parse_qs(parsed.query)
        route = parsed.path[len('/api/v1/'):]
        if handler.command == 'GET':
            if route == 'health':
                data = {'status': 'ok', 'name': 'Mio', 'version': VERSION}
            elif route == 'capabilities':
                data = capabilities()
            elif route == 'openapi.json':
                # Schema itself is unwrapped for OpenAPI tooling.
                handler.send_json(200, openapi())
                return True
            elif route == 'providers':
                data = provider_list(backend.read_merged_config())
            elif route in ('storyboards', 'albums'):
                data = list_resources(backend.read_merged_config(), route, query)
            elif route == 'assets':
                path = query.get('path', [''])[0]
                if not path.startswith('/images/') or '..' in urllib.parse.unquote(path).replace('\\', '/').split('/'):
                    raise ApiError(400, 'invalid_asset', 'Only local /images/ paths are accepted')
                try:
                    data = {'dataUrl': backend.image_url_to_data_url(path)}
                except (ValueError, FileNotFoundError):
                    raise ApiError(404, 'asset_not_found', 'Local asset not found') from None
            else:
                raise ApiError(404, 'not_found', 'Unknown API endpoint')
        elif handler.command == 'POST' and route == 'images/generations':
            body = handler.read_json_body(max_bytes=backend.MAX_IMAGE_BYTES * 4 // 3 + 65536)
            payload = generation_payload(body, backend.read_merged_config())
            if not GENERATION_SLOT.acquire(blocking=False):
                raise ApiError(429, 'generation_busy', 'An external generation is already running; do not blindly retry paid requests')
            try:
                try:
                    data = backend.generate_provider_image(payload)
                except ValueError as exc:
                    # Never echo provider content, credentials or reference images.
                    raise ApiError(400, 'generation_rejected', 'Generation rejected; check provider, model, key, balance and parameters') from exc
                except Exception as exc:
                    raise ApiError(502, 'upstream_failure', 'Upstream failed or timed out; check provider billing before retrying') from exc
                data['assetEndpoint'] = '/api/v1/assets?' + urllib.parse.urlencode({'path': data['image']})
            finally:
                GENERATION_SLOT.release()
        elif handler.command not in ('GET', 'POST'):
            raise ApiError(405, 'method_not_allowed', 'Supported methods: GET and POST')
        else:
            raise ApiError(404, 'not_found', 'Unknown API endpoint')
        send(200, data)
    except ApiError as exc:
        send(exc.status, error={'code': exc.code, 'message': exc.message})
    except backend.PayloadTooLargeError:
        send(413, error={'code': 'payload_too_large', 'message': 'Request exceeds the body size limit'})
    except (ValueError, TypeError, KeyError):
        send(400, error={'code': 'invalid_request', 'message': 'Invalid JSON request or parameters'})
    except Exception:
        send(500, error={'code': 'internal_error', 'message': 'The request could not be completed'})
    return True
