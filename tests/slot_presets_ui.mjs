import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({args:['--no-sandbox']});
const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const errors=[];p.on('pageerror',e=>errors.push(e.message));
try{
 await p.goto(process.env.MIO_TEST_URL || 'http://127.0.0.1:8000');
 await p.waitForFunction(()=>typeof rt!=='undefined'&&!rt.booting&&backendRuntime.connected);
 await p.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());state.settings.identity.onboarded=true;guidePreferences().seen=true;navigate(3);});
 await p.locator('.wf-bar [data-act="wf-presets"]').click();
 await p.locator('[data-act="wf-preset-edit"]').first().click();
 await p.locator('#slot-preset-title').fill('可携带的常用槽位');
 await p.locator('[data-act="wf-preset-save"]').click();
 assert.equal(await p.locator('.wf-preset-card').count(),2);
 const downloadEvent=p.waitForEvent('download');await p.locator('[data-act="wf-preset-export"]').last().click();const dl=await downloadEvent;const exported=JSON.parse(fs.readFileSync(await dl.path(),'utf8'));assert.equal(exported.kind,'mio.slot-preset');assert.equal('nodeId' in exported.preset.rows[0],false);
 const chooserEvent=p.waitForEvent('filechooser');await p.locator('[data-act="wf-preset-import"]').click();const chooser=await chooserEvent;await chooser.setFiles({name:'preset.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});await p.locator('#slot-preset-title').waitFor();assert.equal(await p.locator('[data-preset-row]').count(),4);
 await p.evaluate(()=>closeModal());
 const result=await p.evaluate(()=>{
   const c={workflow:{1:{class_type:'CLIPTextEncode',inputs:{text:''}},2:{class_type:'CLIPTextEncode',inputs:{text:''}},3:{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'base.safetensors'}},4:{class_type:'LoraLoader',inputs:{lora_name:'style.safetensors',strength_model:1,strength_clip:1,model:['3',0],clip:['3',1]}}},bindings:[],slots:{model:{enabled:false},lora:{mode:'off'}}};
   const recipe=validateSlotPreset(SLOT_PRESET_DEFAULT);
   const before=JSON.stringify(c);
   let failed=false;try{applySlotPresetTargets(recipe,[{index:0,nodeId:'999',path:'text'}],c);}catch{failed=true;}
   if(!failed||JSON.stringify(c)!==before)throw Error('Invalid target mutated workflow');
   const targets=recipe.rows.map((r,i)=>({index:i,nodeId:String(i+1),path:r.path}));
   const applied=applySlotPresetTargets(recipe,targets,c);
   let conflict=false;try{applySlotPresetTargets(recipe,targets,{...c,...applied});}catch{conflict=true;}
   Object.assign(state.settings.comfy,c,applied,{workflowTitle:'日常出图 · 槽位工作流'});mapperUI.selected='';render();
   return {bindings:applied.bindings.length,model:applied.slots.model.nodeId,lora:applied.slots.lora.nodeId,conflict,mode:state.settings.comfy.mode};
 });
 assert.deepEqual(result,{bindings:2,model:'3',lora:'4',conflict:true,mode:'real'});
 assert.equal(await p.locator('.wf-channel-nav').count(),1);
 assert.equal(await p.locator('.wf-row[data-binding-row]').count(),4);
 assert.equal(await p.locator('.wf-row .wf-row-target:visible').count(),0);
 await p.selectOption('#wm-filter-select','enabled');assert.equal(await p.locator('.wf-row[data-binding-row]').count(),4);
 await p.selectOption('#wm-filter-select','all');
 fs.mkdirSync('docs/acceptance-slot-presets',{recursive:true});
 await p.mouse.move(1400,80);await p.evaluate(()=>setRailOpen(false));
 await p.screenshot({path:'docs/acceptance-slot-presets/desktop.png',fullPage:true});
 await p.locator('.wf-bar [data-act="wf-presets"]').click();await p.locator('[data-act="wf-preset-apply"]').first().click();
 await p.locator('[data-act="wf-preset-confirm"]').click();assert.match(await p.locator('#slot-preset-error').innerText(),/不存在/);
 await p.screenshot({path:'docs/acceptance-slot-presets/preset-apply.png',fullPage:true});
 await p.evaluate(()=>{state.settings.comfy.bindings=[];state.settings.comfy.slots={model:{enabled:false},lora:{mode:'off'}};});
 for(let i=0;i<4;i++)await p.locator('[data-recipe-node]').nth(i).fill(String(i+1));
 await p.locator('[data-act="wf-preset-confirm"]').click();assert.equal(await p.evaluate(()=>state.settings.comfy.bindings.length),2);
 await p.locator('.wf-channel-tab').nth(1).click();assert.equal(await p.locator('.wf-page-cloud').count(),1);await p.locator('.wf-channel-tab').first().click();
 await p.setViewportSize({width:390,height:844});await p.evaluate(()=>render());await p.locator('.wf-rail-select').waitFor({state:'visible'});
 await p.screenshot({path:'docs/acceptance-slot-presets/mobile.png',fullPage:true});
 const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'Mobile viewport overflow');
 await p.locator('.wf-edit-row').first().click();assert.equal(await p.locator('.wf-inspector').count(),1);await p.locator('[data-act="wf-detail-close"]').click();
 await p.locator('.wf-bar [data-act="wf-presets"]').click();
 await p.screenshot({path:'docs/acceptance-slot-presets/mobile-presets.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: preset save, validation, atomic application, duplicate protection, unified filtering, responsive layouts; no JS errors');
}finally{await browser.close();}
