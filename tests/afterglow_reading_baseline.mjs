// Reproduce geometry in the HTML actually shipped inside the previous ZIP.
// node tests/afterglow_reading_baseline.mjs /path/to/mio-1.2.0-source.zip /evidence
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const zip=path.resolve(process.argv[2]),evidence=path.resolve(process.argv[3]||'test-results/afterglow-baseline');mkdirSync(evidence,{recursive:true});
const temp=mkdtempSync(path.join(tmpdir(),'afterglow-baseline-'));let browser;
try{
 const html=execFileSync('python',['-c',"import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);p=next(n for n in z.namelist() if n.endswith('/examples/afterglow/余光_AFTERGLOW_演示画册.html'));sys.stdout.buffer.write(z.read(p))",zip],{maxBuffer:16*1024*1024});const file=path.join(temp,'baseline.html');writeFileSync(file,html);
 browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await page.goto('file://'+file);await page.waitForFunction(()=>!!window.MioAfterglow);await page.locator('.ag-image').evaluateAll(a=>Promise.all(a.map(i=>{i.loading='eager';return i.decode()})));
 const result=await page.locator('.ag-frame').evaluateAll(a=>{const p=a[1].querySelector('.ag-image').getBoundingClientRect(),q=a[2].querySelector('.ag-image').getBoundingClientRect(),cap=a[1].querySelector('.ag-caption').getBoundingClientRect();return {portraitWidth:p.width,squareWidth:q.width,scaleRatio:q.width/p.width,portraitCaptionIsBesideImage:cap.right<p.left}});
 console.log(JSON.stringify(result,null,2));assert.ok(result.scaleRatio>1.4&&result.portraitCaptionIsBesideImage,'actual old export reproduces inconsistent image scale and separated side caption');await page.locator('.ag-frame').nth(1).screenshot({path:path.join(evidence,'baseline-portrait.png')});console.log('PASS reproduced the reported structural reading problem in actual delivered 1.2.0 HTML');
}finally{await browser?.close();rmSync(temp,{recursive:true,force:true})}
