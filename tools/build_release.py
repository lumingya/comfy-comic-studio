#!/usr/bin/env python3
"""Build the complete Python source distribution, including its vetted data/ resources."""
import base64
import copy
import os
from pathlib import Path
import shutil
import sys
ROOT_DIR=str(Path(__file__).resolve().parents[1])
sys.path.insert(0,ROOT_DIR)

def get_v9_pure_default_data():
    """Conversion-test adapter only; read actual data files, never construct sample content."""
    from backend.mio_content import distribution
    from backend.mio_native_store import NativeStore
    from backend.mio_library import image_type
    distribution(Path(ROOT_DIR)/'data')
    store=NativeStore(Path(ROOT_DIR)/'data',ROOT_DIR)
    try:
        config=store.read(include_baseline=False)
        def inline(v):
            if isinstance(v,str) and v.startswith('/images/'):
                raw,_=store.image_bytes(v);mime,_=image_type(raw)
                return 'data:'+mime+';base64,'+base64.b64encode(raw).decode()
            if isinstance(v,dict):return {k:inline(x) for k,x in v.items() if not k.startswith('_')}
            if isinstance(v,list):return [inline(x) for x in v]
            return v
        c=inline(config)
        settings=c['uiConfig']['comfyStudio']['settings']
        for name in ('comfy','llm','xml'):settings[name]=copy.deepcopy(c[name+'Config'])
        return ({k:c[k] for k in ('templates','savedGalleries')},
                {k:c[k] for k in ('uiConfig','batchMatrix','batchRunState')},
                {'chatConfig':c['chatConfig']},
                {k:c[k] for k in ('comfyWorkflows','comfyConfig')},
                {'llmConfig':c['llmConfig']},{'xmlConfig':c['xmlConfig']})
    finally:store.library.close()

def create_start_bat(dst_path):
    # Share the byte-exact, tested launcher with source releases. Never regenerate
    # it through text newline translation (which can create CRCRLF on Windows).
    source = Path(ROOT_DIR, "start.bat").read_bytes()
    if b"\r\n" not in source or b"\r\r\n" in source or b"\n" in source.replace(b"\r\n", b""):
        raise ValueError("start.bat must use canonical Windows CRLF line endings")
    source.decode("utf-8")
    if source.startswith(b"\xef\xbb\xbf"):
        raise ValueError("start.bat must use UTF-8 without BOM")
    Path(dst_path).write_bytes(source)


def create_readme(dst_path):
    # Include the maintained bilingual entry point.
    shutil.copy2(os.path.join(ROOT_DIR, "README.md"), dst_path)


def build():
    from tools.package_project import build as package
    return package(Path(ROOT_DIR)/'releases')

if __name__=='__main__':build()
