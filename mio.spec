# -*- mode: python ; coding: utf-8 -*-
a = Analysis(['server.py'], pathex=[], binaries=[], datas=[], hiddenimports=['mio_api', 'mio_credentials', 'mio_docs'], hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='mio', debug=False, strip=False, upx=True, console=True)
