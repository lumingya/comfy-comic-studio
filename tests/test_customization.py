import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from backend.ecosystem.customization import Customization
from backend.ecosystem.themes import Themes
from backend.ecosystem.packages import manifest
from backend.mio_library import LibraryError

class CustomizationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.service=Customization(self.root)

    def document(self):
        return {'version':1,'enabled':True,'tokens':{'--accent':'#ff0000'},'snippets':[{'id':'my-css','name':'My CSS','enabled':True,'scope':'global','css':'@import url("https://example.com/font.css");\nbody::before{content:"\\2192"}'}]}

    def test_trust_and_unrestricted_css(self):
        with self.assertRaises(LibraryError):self.service.save(self.document(),0)
        result=self.service.save(self.document(),0,True)
        self.assertEqual(result['document'],self.document())
        self.assertEqual(Customization(self.root).read(),result)

    def test_revision_conflict_never_overwrites(self):
        self.service.save(self.document(),0,True)
        with self.assertRaises(LibraryError) as err:self.service.save(Customization.defaults(),0)
        self.assertEqual(err.exception.status,409)
        self.assertEqual(self.service.read()['document'],self.document())

    def test_history_restore_and_safe_reset_preserves_data(self):
        for i in range(14):
            value=self.document();value['snippets'][0]['css']=str(i)
            self.service.save(value,i,True)
        result=self.service.read();self.assertEqual(len(result['history']),10)
        restored=result['history'][-1]['document'];result=self.service.save(restored,14,True)
        self.assertEqual(result['document']['snippets'][0]['css'],'12')
        self.service.reset();self.assertFalse(self.service.read()['document']['enabled'])
        self.assertEqual(self.service.read()['document']['snippets'],restored['snippets'])

    def test_validation(self):
        mutations=[lambda d:d.update(version=5),lambda d:d.update(enabled='yes'),lambda d:d.update(tokens={'bad':'red'}),lambda d:d['snippets'].append(copy.deepcopy(d['snippets'][0])),lambda d:d['snippets'][0].update(scope='body{}'),lambda d:d['snippets'][0].update(id='../escape'),lambda d:d['snippets'][0].update(css='a'*140000)]
        for mutate in mutations:
            value=self.document();mutate(value)
            with self.assertRaises(LibraryError):self.service.validate(value)
        value=self.document();value['snippets'][0]['scope']='workspace:my-extension:desk'
        self.assertEqual(self.service.validate(value),value)

    def test_trusted_theme_package_and_asset_boundaries(self):
        raw=io.BytesIO()
        with zipfile.ZipFile(raw,'w') as archive:
            archive.writestr('mio.theme.json',json.dumps({'id':'free-theme','name':'Free','version':'1.0','apiVersion':2,'css':'css/theme.css','cssPolicy':'trusted'}))
            archive.writestr('css/theme.css','@import "more.css";body{background:url(https://example.com/image.png)}')
            archive.writestr('css/more.css','body{color:red}')
            archive.writestr('secret.py','secret')
        themes=Themes(self.root);meta=themes.install(raw.getvalue(),'theme.zip',True)
        self.assertEqual(meta['cssPolicy'],'trusted');self.assertIn('@import',themes.css(meta['id']))
        self.assertEqual(themes.asset(meta['id'],'css/more.css').read_text(),'body{color:red}')
        for path in ('../outside','secret.py','/etc/passwd'):
            with self.assertRaises(LibraryError):themes.asset(meta['id'],path)
        themes.select(meta['id']);self.assertEqual(themes.list()['active'],meta['id'])

    def test_sdk2_manifest(self):
        (self.root/'index.js').write_text('export default function(ctx) {}')
        (self.root/'mio.extension.json').write_text(json.dumps({'id':'sdk-two','apiVersion':2,'name':'SDK two','version':'1'}))
        self.assertEqual(manifest(self.root,'extension')['apiVersion'],2)

if __name__=='__main__':unittest.main()
