import json
import re
import tempfile
import unittest
from pathlib import Path
from tools.build_release import create_readme

ROOT = Path(__file__).resolve().parents[1]


class DocumentationTests(unittest.TestCase):
    def test_new_documentation_links_resolve_locally(self):
        files = [ROOT / 'README.md', ROOT / 'README.en.md', ROOT / 'SECURITY.md', ROOT / 'docs/README.md', ROOT / 'docs/DEVELOPMENT.md']
        for folder in ('guide', 'en', 'api'):
            files.extend((ROOT / 'docs' / folder).glob('*.md'))
        for file in files:
            for link in re.findall(r'\]\(([^)]+)\)|(?:href|src)="([^"]+)"', file.read_text()):
                target = next(value for value in link if value)
                if target.startswith(('http:', 'https:', 'data:', '#')):
                    continue
                self.assertTrue((file.parent / target.split('#')[0]).exists(), f'{file.name}: {target}')

    def test_release_readme_is_the_maintained_readme(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / 'README.md'
            create_readme(dest)
            self.assertEqual(dest.read_text(), (ROOT / 'README.md').read_text())

    def test_product_metadata_and_portable_spec(self):
        package = json.loads((ROOT / 'package.json').read_text())
        self.assertEqual(package['name'], 'mio-studio')
        self.assertEqual(package['version'], '1.0.0')
        spec = (ROOT / 'mio.spec').read_text()
        self.assertNotIn('C:\\Users', spec)
        self.assertIn('mio_api', spec)
        self.assertTrue((ROOT / 'docs/assets/mio-logo.png').exists())
