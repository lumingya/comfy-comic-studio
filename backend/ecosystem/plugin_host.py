"""Trusted Python extension process. Isolation contains crashes, not malicious OS access."""
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from backend.ecosystem.storage import Storage

wire=sys.stdout
sys.stdout=sys.stderr
routes={}
def route(path,method='POST'):
    if not isinstance(path,str) or not path.startswith('/') or '..' in path:raise ValueError('Use a package-relative route')
    key=(method.upper(),path)
    def register(fn):
        if key in routes:raise ValueError('Duplicate extension route')
        routes[key]=fn;return fn
    return register

def send(value):wire.write(json.dumps(value,ensure_ascii=False,allow_nan=False)+'\n');wire.flush()

def main():
    folder=Path(sys.argv[1]); data=Path(sys.argv[2])
    ctx=SimpleNamespace(storage=Storage(data),route=route,plugin_dir=folder,data_dir=data,log=lambda *v:print(*v,file=sys.stderr))
    spec=importlib.util.spec_from_file_location('mio_user_plugin',folder/'plugin.py');mod=importlib.util.module_from_spec(spec)
    sys.path.insert(0,str(folder));spec.loader.exec_module(mod)
    if hasattr(mod,'setup'):mod.setup(ctx)
    if hasattr(mod,'on_load'):mod.on_load(ctx)
    send({'ready':True,'routes':[{'method':m,'path':p} for m,p in routes]})
    for line in sys.stdin:
        try:
            req=json.loads(line)
            if req.get('stop'):
                if hasattr(mod,'on_unload'):mod.on_unload(ctx)
                send({'ok':True});break
            fn=routes.get((req['method'],req['path']))
            if not fn:raise ValueError('Extension route not registered')
            result=fn(req.get('body',{}));raw=json.dumps(result,allow_nan=False)
            if len(raw)>2*1024*1024:raise ValueError('Extension response too large')
            send({'ok':True,'result':result})
        except Exception as e:send({'ok':False,'error':str(e)[:500]})
if __name__=='__main__':
    try:main()
    except Exception as e:send({'ok':False,'error':str(e)[:500]})
