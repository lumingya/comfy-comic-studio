#!/usr/bin/env python3
"""Build a complete source-run ZIP. Never copy or modify an existing data/.

No Node dependency, no PyInstaller and no silent executable-build fallback.
Run from any cwd: python /path/to/Mio/tools/package_project.py --output /path
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
FOLDERS = {'js', 'vendor', 'backend', 'packaging', 'docs', 'examples', 'tests', 'tools'}
ROOT_NAMES = {'package.json', 'package-lock.json', 'start.bat', 'start.sh',
              'build_release.bat', '.eslintrc.json', '.htmlvalidate.json',
              '.gitignore', '.gitattributes', 'LICENSE', 'favicon.svg',
              'styles.css'}
EXCLUDED = {'__pycache__', 'node_modules', '.git', '.cache', 'data', 'images',
            'build', 'dist', 'test-results', '.venv'}


def source_files():
    from backend.mio_content import distribution
    manifest=distribution(ROOT/'data')
    for rel in sorted(manifest['files']):yield ROOT/'data'/rel,'data/'+rel
    yield ROOT/'data/distribution.json','data/distribution.json'
    for path in sorted(ROOT.rglob('*')):
        rel = path.relative_to(ROOT)
        if any(part in EXCLUDED or part.startswith('acceptance') for part in rel.parts) or path.is_symlink() or not path.is_file():
            continue
        if len(rel.parts) == 1:
            if path.name not in ROOT_NAMES and path.suffix not in {'.py', '.md', '.html', '.spec'}:
                continue
        elif rel.parts[0] not in FOLDERS:
            continue
        if path.suffix in {'.pyc', '.pyo', '.sqlite3', '.zip'} or path.name.endswith(('.tmp', '.bak')):
            continue
        yield path, rel.as_posix()


def build(output):
    version = json.loads((ROOT / 'package.json').read_text())['version']
    name = f'mio-{version}-source'
    output.mkdir(parents=True, exist_ok=True)
    target = output / (name + '.zip')
    files = list(source_files())
    paths = {rel for _, rel in files}
    required = {'js/architecture.js','tests/architecture.mjs','docs/ARCHITECTURE_ACCEPTANCE.md','backend/production/store.py','backend/production/queue.py','backend/production/api.py','js/assembly-workshop.js','js/preferences-workbench.js','backend/ecosystem/acorn.cjs','backend/ecosystem/ACORN_LICENSE','backend/ecosystem/macro_worker.mjs','backend/ecosystem/macro_analyze.mjs','backend/ecosystem/api.py','js/ecosystem.js','js/safe-mode.js','docs/ECOSYSTEM_GUIDE.html','docs/COMPUTED_VARIABLES.html','examples/extensions/scene-notebook/index.js','examples/macros/prerequisite-variables.json','docs/RELEASE_CURRENT.md','tests/preset_isolation.mjs','data/distribution.json','data/catalog/index.json','data/catalog/reader-sizing.json','backend/mio_content.py','backend/mio_album_html.py','backend/mio_resource_sharing.py','js/content-loader.js','js/album-metadata.js','js/contextual-sharing.js','docs/guide/CONTENT_AND_SHARING.html','docs/en/CONTENT_AND_SHARING.html','server.py', 'backend/mio_lifecycle.py', 'backend/mio_frame_jobs.py', 'js/foundation.js',
                'start.bat', 'start.sh', 'index.html', 'styles.css', 'backend/mio_pictures.py', 'js/ui-image-studio.js', 'js/ui-template-seamless.js','backend/mio_native_store.py','backend/mio_library_conversion.py','tools/convert_file_library.py','backend/mio_pictures.py','backend/mio_library.py','backend/mio_library_settings.py','backend/mio_library_workspace.py','backend/mio_safe_svg.py','js/file-library.js','docs/guide/FILE_LIBRARY.html','docs/en/FILE_LIBRARY.html', 'js/ui-template-afterglow.js', 'examples/afterglow/余光_AFTERGLOW_演示画册.html', 'examples/image-assets/starter.json'}
    if not required <= paths:
        raise RuntimeError('Missing required files: ' + ', '.join(sorted(required - paths)))
    html = (ROOT / 'index.html').read_text()
    if 'studio-runtime' in html or len(html) > 50000:
        raise RuntimeError('Expected the external-JS/CSS shell, not an inline bundle')
    manifest = {'name': 'Mio', 'version': version, 'kind': 'complete-source-runtime',
                'upstreamBaseline': '9ee1a0b', 'runtime': 'Python >= 3.10; computed variables: Node.js >= 20; Git installs: Git',
                'includesUserData': False, 'includesShippedData': True,
                'files': {rel: hashlib.sha256(path.read_bytes()).hexdigest() for path, rel in files}}
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path, rel in files:
            archive.write(path, name + '/' + rel)
        archive.writestr(name + '/PACKAGE_MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    with zipfile.ZipFile(target) as archive:
        if archive.testzip():
            raise RuntimeError('ZIP CRC verification failed')
        for rel, checksum in manifest['files'].items():
            if hashlib.sha256(archive.read(name + '/' + rel)).hexdigest() != checksum:
                raise RuntimeError('Packaged content mismatch: ' + rel)
        if any('/node_modules/' in p or '/.git/' in p or '/secrets.json' in p or '/runtime/' in p for p in archive.namelist()):
            raise RuntimeError('Private/generated directory leaked into package')
    checksum = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.zip.sha256').write_text(checksum + '  ' + target.name + '\n')
    print(f'ZIP verified: {target}\nFiles: {len(files)} + manifest\nBytes: {target.stat().st_size}\nSHA256: {checksum}')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'releases')
    build(parser.parse_args().output.resolve())
