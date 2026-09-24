import json
import re
import tempfile
import unittest
from pathlib import Path
from tools.build_release import create_readme

ROOT = Path(__file__).resolve().parents[1]


class DocumentationTests(unittest.TestCase):
    def test_new_documentation_links_resolve_locally(self):
        files = [ROOT / 'README.md', ROOT / 'docs/README.en.md', ROOT / 'docs/SECURITY.md', ROOT / 'docs/README.md', ROOT / 'docs/DEVELOPMENT.md']
        for folder in ('guide', 'en', 'api'):
            files.extend((ROOT / 'docs' / folder).glob('*.md'))
        for file in files:
            prose = re.sub(r'^```[^\n]*\n.*?^```\s*$', '', file.read_text(), flags=re.M | re.S)
            for link in re.findall(r'\]\(([^)]+)\)|(?:href|src)="([^"]+)"', prose):
                target = next(value for value in link if value)
                if target.startswith(('http:', 'https:', 'data:', '#')):
                    continue
                resolved = file.parent / target.split('#')[0]
                self.assertTrue(resolved.exists() or (resolved.suffix == '.html' and resolved.with_suffix('.md').exists()), f'{file.name}: {target}')

    def test_every_document_link_resolves(self):
        # Every Markdown document in the repository, not only the user guides (generated acceptance folders excluded).
        files = [ROOT / 'README.md'] + [p for p in (ROOT / 'docs').rglob('*.md') if not any(part.startswith('acceptance') for part in p.relative_to(ROOT / 'docs').parts)]
        dead = []
        for file in files:
            prose = re.sub(r'^```[^\n]*\n.*?^```\s*$', '', file.read_text(encoding='utf-8'), flags=re.M | re.S)
            prose = re.sub(r'`[^`\n]*`', '', prose)
            for target in re.findall(r'\]\(([^)\s]+)[^)]*\)', prose) + re.findall(r'(?:href|src)="([^"]+)"', prose):
                if target.startswith(('http:', 'https:', 'data:', 'mailto:', '#')):
                    continue
                resolved = file.parent / target.split('#')[0]
                if not (resolved.exists() or (resolved.suffix == '.html' and resolved.with_suffix('.md').exists())):
                    dead.append(f'{file.relative_to(ROOT)}: {target}')
        self.assertEqual(dead, [])

    def test_handbook_landing_page_links_resolve(self):
        page = ROOT / 'docs' / 'index.html'
        slug = lambda text: re.sub(r'\s+', '-', re.sub(r'[^\w\-\s]', '', text.strip().lower())) or 'section'
        for target in re.findall(r'(?:href|data-zh-href|data-en-href)="([^"]+)"', page.read_text(encoding='utf-8')):
            if target.startswith(('http:', 'https:', '#', 'mailto:')):
                continue
            path, _, anchor = target.partition('#')
            resolved = page.parent / path
            source = resolved.with_suffix('.md') if resolved.suffix == '.html' else resolved
            self.assertTrue(resolved.exists() or source.exists(), target)
            if anchor:
                headings = [slug(h) for h in re.findall(r'^#{1,3} (.+)$', source.read_text(encoding='utf-8'), flags=re.M)]
                self.assertIn(anchor, headings, target)

    def test_documents_agree_on_the_current_version(self):
        version = json.loads((ROOT / 'package.json').read_text())['version']
        self.assertIn(version, (ROOT / 'docs/CHANGELOG.md').read_text(encoding='utf-8').splitlines()[0])
        for name in ('RELEASE_CURRENT.md', 'CURRENT_STATUS.md'):
            self.assertIn(version, (ROOT / 'docs' / name).read_text(encoding='utf-8')[:600], f'{name} must not present an older version as current')

    def test_readme_handbook_link_renders_on_github(self):
        self.assertIn('[教程中心](docs/README.md)', (ROOT / 'README.md').read_text(encoding='utf-8'))

    def test_release_readme_is_the_maintained_readme(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / 'README.md'
            create_readme(dest)
            self.assertEqual(dest.read_text(), (ROOT / 'README.md').read_text())

    def test_product_metadata_and_complete_source_packager(self):
        package = json.loads((ROOT / 'package.json').read_text())
        self.assertEqual(package['name'], 'mio-studio')
        self.assertEqual(package['version'], '3.2.0-dev.1')
        self.assertIn("MIO_VERSION='"+package['version']+"'",(ROOT/'js/app.js').read_text())
        self.assertTrue((ROOT/'docs/RELEASE_CURRENT.md').exists())
        builder=(ROOT/'tools/package_project.py').read_text()
        self.assertIn('distribution',builder)
        self.assertIn('includesShippedData',builder)
        self.assertTrue((ROOT / 'docs/assets/mio-logo.png').exists())
