# -*- mode: python ; coding: utf-8 -*-
a = Analysis(['server.py'], pathex=[], binaries=[], datas=[], hiddenimports=['mio_contracts', 'mio_foundation', 'mio_jobs', 'providers.cloud', 'providers.novelai', 'providers.openai_chat', 'providers.openai_images', 'providers.comfyui', 'mio_api', 'mio_credentials', 'mio_docs'], hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='mio', debug=False, strip=False, upx=True, console=True)
