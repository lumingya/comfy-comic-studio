"""Server-side ComfyUI transport: upload -> submit once -> poll -> persist."""
import json
import time
import uuid
import urllib.parse
import urllib.request
import urllib.error

def generate(payload, host):
    config = payload['config']; base = config.get('baseUrl', '').rstrip('/')
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Invalid ComfyUI URL')
    workflow = json.loads(json.dumps(payload.get('workflow', {})))
    if not workflow or not isinstance(workflow, dict):
        raise ValueError('ComfyUI requires an API workflow')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    from providers.transport import opener as cancelable_opener
    opener = cancelable_opener(payload,NoRedirect)
    deadline=time.monotonic()+payload.get('_requestTimeout',600)
    def request(path, data=None, content_type='application/json'):
        if payload.get('_isCanceled',lambda:False)():raise InterruptedError('Stopped locally; output discarded')
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('ComfyUI configured timeout reached; result unconfirmed')
        try:
            with opener.open(urllib.request.Request(base+path, data=data, headers={'Content-Type':content_type}), timeout=min(remaining,payload.get('_requestTimeout',300))) as response:
                return host.read_limited_response(response)
        except urllib.error.HTTPError as exc:
            raise host.ProviderHTTPError(exc.code, host.read_limited_response(exc, 2*1024*1024)) from None
    prompt_id=payload.get('_resumePromptId')
    if not prompt_id:
        inputs = payload.get('images', [])
        if not isinstance(inputs, list) or len(inputs)>32:
            raise ValueError('At most 32 ComfyUI image inputs')
        raw_inputs = [host.provider_image_input(src) for src in inputs]
        if sum(len(raw) for _, raw in raw_inputs)>host.MAX_IMAGE_BYTES:
            raise ValueError('Combined inputs exceed 50 MiB')
        def replace(value, token, filename):
            if isinstance(value, dict):return {k:replace(v,token,filename) for k,v in value.items()}
            if isinstance(value, list):return [replace(v,token,filename) for v in value]
            return filename if value == token else value
        for i, (_, raw) in enumerate(raw_inputs):
            token='mio-image://'+str(i+1)
            if token not in json.dumps(workflow):raise ValueError('Unbound image '+str(i+1))
            if payload.get('_isCanceled',lambda:False)():raise InterruptedError('Stopped locally; output discarded')
            mime=host.detect_image_mime_type(raw);ext={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[mime]
            boundary='mio'+uuid.uuid4().hex
            data=(f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{uuid.uuid4().hex}{ext}"\r\nContent-Type: {mime}\r\n\r\n').encode()+raw+f'\r\n--{boundary}--\r\n'.encode()
            uploaded=json.loads(request('/upload/image',data,'multipart/form-data; boundary='+boundary))
            if not uploaded.get('name'):raise ValueError('ComfyUI upload returned no filename')
            workflow=replace(workflow,token,(uploaded.get('subfolder','')+'/').lstrip('/')+uploaded['name'])
        if payload.get('_onRequest'):
            from providers.request_evidence import safe_request
            payload['_onRequest'](safe_request({'workflow':workflow}))
        submitted=json.loads(request('/prompt',json.dumps({'prompt':workflow,'client_id':uuid.uuid4().hex}).encode()))
        prompt_id=submitted.get('prompt_id')
        if not prompt_id:raise ValueError('ComfyUI rejected workflow: '+json.dumps(submitted))
        if payload.get('_checkpoint'):payload['_checkpoint'](prompt_id)
    while time.monotonic()<deadline:
        history=json.loads(request('/history/'+urllib.parse.quote(prompt_id,safe=''))).get(prompt_id)
        if not history:time.sleep(1);continue
        if history.get('status',{}).get('status_str')=='error':raise ValueError(json.dumps(history['status']))
        outputs=history.get('outputs',{});node=config.get('outputNodeId')
        records=outputs.get(node,{}).get('images',[]) if node else [im for output in outputs.values() for im in output.get('images',[])]
        if len(records)>32:raise ValueError('Too many ComfyUI outputs')
        artifacts=[];total=0
        for image in records:
            raw=request('/view?'+urllib.parse.urlencode({k:image.get(k,'') for k in ('filename','subfolder','type')}))
            total+=len(raw)
            if total>host.MAX_IMAGE_BYTES:raise ValueError('Combined outputs exceed 50 MiB')
            if payload.get('_isCanceled',lambda:False)():raise InterruptedError('Stopped locally; output discarded')
            mime=host.detect_image_mime_type(raw)
            if mime not in ('image/png','image/jpeg','image/webp'):raise ValueError('Unsupported output format')
            url=host.store_image_data(host.bytes_to_data_url(raw,mime),payload.get('albumId','unassigned'))
            artifacts.append({'kind':'image','url':url,'mime':mime,'bytes':len(raw)})
        if artifacts:return {'image':artifacts[0]['url'],'artifacts':artifacts,'provider':'comfyui','promptId':prompt_id,'offlineFallback':False}
        if history.get('status',{}).get('completed'):raise ValueError('ComfyUI completed without images')
        time.sleep(1)
    raise TimeoutError('ComfyUI result not confirmed; inspect upstream history before resubmitting')
