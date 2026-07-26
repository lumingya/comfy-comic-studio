// tests/smoke.mjs - 端到端冒烟测试：覆盖启动、渲染、编辑、持久化、离线降级等关键路径。
// 用法： node tests/smoke.mjs          （自动拉起 server.py，使用临时 data/ 目录）
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 8791);
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
    const ok = !!condition;
    if (!ok) failures++;
    results.push(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok || !detail ? '' : ` -> ${detail}`}`);
    return ok;
}

async function waitForServer(timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${BASE}/api/config`);
            if (res.ok) return true;
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 200));
    }
    return false;
}

const sandbox = mkdtempSync(path.join(tmpdir(), 'ccs-smoke-'));
for (const name of ['index.html', 'server.py', 'styles.css', 'favicon.svg']) {
    cpSync(path.join(ROOT, name), path.join(sandbox, name));
}
for (const dir of ['vendor', 'js']) {
    cpSync(path.join(ROOT, dir), path.join(sandbox, dir), { recursive: true });
}
mkdirSync(path.join(sandbox, 'images'), { recursive: true });

const server = spawn('python3', ['server.py'], {
    cwd: sandbox,
    env: { ...process.env, COMFY_COMIC_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErr = '';
server.stderr.on('data', d => { serverErr += d.toString(); });

let browser;
try {
    if (!await waitForServer()) throw new Error(`server did not start on ${PORT}\n${serverErr}`);

    const launchOptions = { args: ['--no-sandbox'] };
    // 允许用 CCS_CHROMIUM 指定浏览器可执行文件（CI / 沙箱里通常已预装 Chromium）。
    const overrideBrowser = process.env.CCS_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '');
    if (overrideBrowser) launchOptions.executablePath = overrideBrowser;
    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext();
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // 关键路径 1：完全断网（CDN 不可达）时应用仍然可用
    await context.route('**://*.jsdelivr.net/**', route => route.abort());
    await context.route('**://*.unpkg.com/**', route => route.abort());
    await context.route('**://fonts.googleapis.com/**', route => route.abort());
    await context.route('**://fonts.gstatic.com/**', route => route.abort());
    await context.route('**://images.unsplash.com/**', route => route.abort());

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.isAppInitializing === false, null, { timeout: 20000 });

    check('离线加载后没有未捕获的 JS 异常', pageErrors.length === 0, pageErrors.join(' | '));
    check('模板库渲染出条目', await page.locator('#templates-list-container > div').count() > 0);
    check('分镜编辑器渲染出卡片', await page.locator('.step-editor-card').count() > 0);
    check('矩阵表格渲染出行', await page.locator('#matrix-tbody tr').count() > 0);
    check('画廊渲染出卡片', await page.locator('#gallery-container > div').count() > 0);
    check('图标已渲染为 svg（本地 lucide 生效）', await page.locator('header svg').count() > 0);

    // 关键路径 2：标签切换
    await page.click('#tab-btn-templates');
    check('切到模板页后模板面板可见', await page.locator('#tab-templates').isVisible());

    // 关键路径 3：编辑分镜 -> 切换模板 -> 切回来，编辑不能丢
    const editedPrompt = 'A smoke-test prompt for {character}, {style}';
    await page.locator('.step-editor-card .step-prompt').first().fill(editedPrompt);
    const secondTemplate = page.locator('#templates-list-container > div').nth(1);
    if (await secondTemplate.count() > 0) {
        await secondTemplate.click();
        await page.locator('#templates-list-container > div').first().click();
        const back = await page.locator('.step-editor-card .step-prompt').first().inputValue();
        check('切换模板后未保存的分镜编辑不丢失', back === editedPrompt, `got: ${back.slice(0, 60)}`);
    }

    // 关键路径 4：保存模板 -> 数据真正落盘到 data/content.json
    await page.evaluate(() => window.saveCurrentTemplate && window.saveCurrentTemplate());
    await page.waitForTimeout(1500);
    const persisted = await (await fetch(`${BASE}/api/config`)).json();
    const savedPrompt = persisted.templates?.[0]?.steps?.[0]?.prompt || '';
    check('保存后的提示词已落盘到 data/', savedPrompt === editedPrompt, `got: ${savedPrompt.slice(0, 60)}`);

    // 关键路径 5：重新加载后状态从磁盘恢复
    const page2 = await context.newPage();
    await page2.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page2.waitForFunction(() => window.isAppInitializing === false, null, { timeout: 20000 });
    const reloaded = await page2.evaluate(() => templates?.[0]?.steps?.[0]?.prompt || '');
    check('重载后从磁盘恢复出刚才的编辑', reloaded === editedPrompt, `got: ${reloaded.slice(0, 60)}`);
    await page2.close();

    // 关键路径 6：画廊图片不依赖任何外网地址
    const remoteImages = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('#gallery-container img').forEach(img => {
            if (/^https?:\/\//i.test(img.getAttribute('src') || '') && !img.src.startsWith(location.origin)) {
                bad.push(img.getAttribute('src'));
            }
        });
        return bad;
    });
    check('画廊封面不引用外网图片地址', remoteImages.length === 0, remoteImages.join(', '));

    // 关键路径 7：五个主标签页都能切换且不报错
    for (const tab of ['gallery', 'templates', 'variables', 'workflow', 'llm']) {
        await page.click(`#tab-btn-${tab}`);
        check(`标签页 ${tab} 可切换并可见`, await page.locator(`#tab-${tab}`).isVisible());
    }

    // 关键路径 8：各个弹窗都能打开、渲染内容并关闭
    await page.click('#tab-btn-gallery');
    await page.locator('#gallery-container > div').first().click();
    check('画册详情弹窗可打开', await page.locator('#pixiv-modal').isVisible());
    check('详情弹窗渲染出分镜', await page.locator('#modal-comic-strip .pixiv-manga-card').count() > 0);
    await page.evaluate(() => closePixivModal());
    check('画册详情弹窗可关闭', !(await page.locator('#pixiv-modal').isVisible()));

    await page.click('#tab-btn-templates');
    await page.evaluate(() => openChatRefinementModal());
    check('AI 精修聊天窗可打开', await page.locator('#chat-refinement-modal').isVisible());
    check('聊天会话列表非空', await page.locator('#chat-sessions-list > div').count() > 0);
    await page.evaluate(() => closeChatRefinementModal());

    await page.click('#tab-btn-variables');
    const rowsBefore = await page.locator('#matrix-tbody tr').count();
    await page.evaluate(() => addMatrixRow());
    check('矩阵可新增一行', await page.locator('#matrix-tbody tr').count() === rowsBefore + 1);
    await page.evaluate(() => openScriptModal(batchMatrix.rows[0].id));
    check('剧本编辑弹窗可打开', await page.locator('#script-modal').isVisible());
    check('剧本编辑弹窗渲染出输入框', await page.locator('#script-modal .script-textarea').count() > 0);
    await page.evaluate(() => closeScriptModal());

    await page.click('#tab-btn-llm');
    check('LLM 剧情卡片已渲染', await page.locator('#llm-vertical-captions-list .llm-story-card').count() > 0);

    // 关键路径 9：交互层 —— toast、Esc 关闭浮层、命令面板、确认框
    await page.evaluate(() => notify('冒烟测试提示', { type: 'success' }));
    check('toast 提示会出现', await page.locator('#ccs-toast-container .ccs-toast').count() > 0);

    await page.click('#tab-btn-gallery');
    await page.locator('#gallery-container > div').first().click();
    check('Esc 之前画册弹窗是打开的', await page.locator('#pixiv-modal').isVisible());
    await page.keyboard.press('Escape');
    check('Esc 能关闭画册弹窗', !(await page.locator('#pixiv-modal').isVisible()));

    await page.keyboard.press('Control+k');
    check('Ctrl+K 唤起命令面板', await page.locator('#ccs-palette-host').count() > 0);
    await page.fill('#ccs-palette-input', '画廊');
    check('命令面板能搜到条目', await page.locator('.ccs-palette-item').count() > 0);
    await page.keyboard.press('Escape');
    check('Esc 能关闭命令面板', await page.locator('#ccs-palette-host').count() === 0);

    // 确认框取消时不能真的删数据
    const galleriesBefore = await page.evaluate(() => savedGalleries.length);
    await page.evaluate(() => { deleteGallery(savedGalleries[0].id); });
    await page.waitForSelector('#ccs-dialog-host', { timeout: 5000 });
    check('删除操作会弹出确认框', await page.locator('#ccs-dialog-host').count() > 0);
    await page.click('.ccs-dialog-cancel');
    await page.waitForTimeout(200);
    check('取消确认后画册没有被删除', await page.evaluate(() => savedGalleries.length) === galleriesBefore);

    // 关键路径 10：模拟模式在界面上真的可达，并能跑完一整轮批量出图
    await page.click('#tab-btn-workflow');
    check('运行模式开关存在于页面上', await page.locator('#engine-mock-toggle').count() === 1);
    await page.locator('#engine-mock-toggle').check({ force: true });  // 开关是 sr-only input，被样式化的 span 覆盖
    check('打开开关后进入模拟模式', await page.evaluate(() => isMockMode) === true);

    const expectedPanels = await page.evaluate(() => {
        templates[0].steps = templates[0].steps.slice(0, 2);
        batchMatrix.rows.forEach((row, i) => { row.active = i === 0; });
        // 先把内存改动刷回编辑器 DOM，再保存 —— saveCurrentTemplate() 是从 DOM 读分镜的
        populateActiveTemplateSteps();
        saveCurrentTemplate();
        return templates[0].steps.length;
    });
    await page.click('#tab-btn-variables');
    const booksBefore = await page.evaluate(() => savedGalleries.length);
    await page.evaluate(() => startBatchGeneration());
    await page.waitForFunction(() => runningBatch === false && batchRunState.status === 'completed', null, { timeout: 60000 });
    check('模拟模式能跑完一整轮批量出图', await page.evaluate(() => savedGalleries.length) === booksBefore + 1);
    const newBook = await page.evaluate(() => savedGalleries[0]);
    check('生成的画册标记为完成', newBook.status === 'complete', JSON.stringify(newBook.status));
    check('生成的分镜数量与模板一致', (newBook.steps || []).length === expectedPanels, `${(newBook.steps || []).length} vs ${expectedPanels}`);
    check('模拟出图不引用外网地址', (newBook.steps || []).every(s => String(s.image).startsWith('data:')));

    // 关键路径 11：全局主线大纲控件存在，且能回落到模板简介
    await page.click('#tab-btn-llm');
    check('全局主线大纲输入框存在', await page.locator('#global-story-prompt').count() === 1);
    const outlineFallback = await page.evaluate(() => {
        document.getElementById('global-story-prompt').value = '';
        return resolveGlobalStoryOutline(templates[0]);
    });
    check('留空时回落到模板简介', outlineFallback === (await page.evaluate(() => templates[0].desc)), outlineFallback);

    // 关键路径 12：服务端静态资源边界
    for (const [p, expected] of [['/data/llm.json', 404], ['/server.py', 404], ['/index.html', 200], ['/js/core.js', 200], ['/vendor/lucide.min.js', 200], ['/js/../server.py', 404]]) {
        const res = await fetch(`${BASE}${p}`);
        check(`静态边界 ${p} -> ${expected}`, res.status === expected, `got ${res.status}`);
    }

    check('全流程结束时仍无 JS 异常', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
    failures++;
    results.push(` FAIL  测试执行本身抛出异常 -> ${err.message}`);
} finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(results.join('\n'));
console.log(failures === 0 ? `\n全部 ${results.length} 项冒烟检查通过。` : `\n${failures}/${results.length} 项冒烟检查失败。`);
process.exit(failures ? 1 : 0);
