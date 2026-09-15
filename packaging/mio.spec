from pathlib import Path
PROJECT_ROOT = str(Path(SPECPATH).parent)
# -*- mode: python ; coding: utf-8 -*-
a = Analysis([str(Path(PROJECT_ROOT)/'server.py')], pathex=[PROJECT_ROOT], binaries=[], datas=[], hiddenimports=['backend.mio_native_store', 'backend.mio_library', 'backend.mio_library_settings', 'backend.mio_library_workspace', 'backend.mio_safe_svg', 'backend.mio_frame_jobs', 'backend.mio_lifecycle', 'backend.mio_pictures', 'backend.mio_contracts', 'backend.mio_foundation', 'backend.mio_jobs', 'backend.providers.cloud', 'backend.providers.novelai', 'backend.providers.openai_chat', 'backend.providers.openai_images', 'backend.providers.comfyui', 'backend.mio_api', 'backend.mio_credentials', 'backend.mio_docs'], hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='mio', debug=False, strip=False, upx=True, console=True)
