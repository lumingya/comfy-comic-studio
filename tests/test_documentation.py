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
                self.assertTrue((file.parent / target.split('#')[0]).exists(), f'{file.name}: {target}')

    def test_release_readme_is_the_maintained_readme(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / 'README.md'
            create_readme(dest)
            self.assertEqual(dest.read_text(), (ROOT / 'README.md').read_text())

    def test_product_metadata_and_complete_source_packager(self):
        package = json.loads((ROOT / 'package.json').read_text())
        self.assertEqual(package['name'], 'mio-studio')
        self.assertEqual(package['version'], '3.1.0-dev.3')
        self.assertIn("MIO_VERSION='"+package['version']+"'",(ROOT/'js/app.js').read_text())
        self.assertTrue((ROOT/'docs/RELEASE_CURRENT.html').exists())
        builder=(ROOT/'tools/package_project.py').read_text()
        self.assertIn('distribution',builder)
        self.assertIn('includesShippedData',builder)
        self.assertTrue((ROOT / 'docs/assets/mio-logo.png').exists())
