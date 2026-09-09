// js/export_templates.js - 多维度画册模板系统（Layout & Aesthetic Presets）
// 提供四大专业版式独立单文件 HTML 导出引擎：Webtoon 条漫、Manga Grid 日漫、Artbook 摄影集与 3D 拟真翻页书。

const COMIC_EXPORT_PRESETS = [
    {
        id: 'webtoon',
        name: '沉浸条漫 (Webtoon)',
        badge: '移动端优先',
        desc: '垂直无限流长条漫，自适应手机与桌面端，带有阅读进度、平滑间距与悬浮半透明旁白对白层。',
        icon: 'smartphone',
        theme: 'dark'
    },
    {
        id: 'manga_grid',
        name: '经典日漫分镜 (Manga Grid)',
        badge: '分镜版式',
        desc: '经典漫画多格交错布局，模拟黑白/彩色实体漫画书的分格张力，配合复古网点框与漫画对白标签。',
        icon: 'layout-grid',
        theme: 'comic'
    },
    {
        id: 'artbook_lookbook',
        name: '典雅画集 (Artbook Lookbook)',
        badge: '艺术画册',
        desc: '高端时尚画册与摄影集风格，大比例留白、极简排版、色块底纹，并附带提示词参数水印。',
        icon: 'book-open',
        theme: 'editorial'
    },
    {
        id: 'flipbook_3d',
        name: '拟真 3D 翻页书 (3D Flipbook)',
        badge: '沉浸拟物',
        desc: '纯前端 CSS3 3D 拟真翻页书，支持键盘左右键及点击翻页，带书脊阴影、翻页转动弧度与封面封底。',
        icon: 'book',
        theme: '3d'
    }
];

window.COMIC_EXPORT_PRESETS = COMIC_EXPORT_PRESETS;

/**
 * 通用 HTML 转义工具
 */
function escapeTemplateHtml(str) {
    if (!str) return '';
    const s = String(str);
    // 仅当 Data URL 严格符合无引号、无尖括号且无空白的纯净 Base64 格式时才跳过转义，防御恶意属性逃逸与 XSS
    if (/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * 校验并净化十六进制颜色，防止样式与代码注入
 */
function sanitizeHexColor(color, defaultColor = '#6366f1') {
    return /^#[0-9a-fA-F]{3,8}$/.test(String(color || '')) ? color : defaultColor;
}

/**
 * 模板生成器集合
 */
const ComicTemplateGenerators = {
    /**
     * 1. Webtoon 条漫模式
     */
    webtoon(book, embeddedImages, options = {}) {
        const title = escapeTemplateHtml(book.title || '连环画故事');
        const synopsis = escapeTemplateHtml(book.synopsis || '');
        const character = escapeTemplateHtml(book.characterName || '');
        const showPrompts = !!options.showPrompts;
        const themeColor = sanitizeHexColor(options.themeColor, '#6366f1');

        const panelsHtml = (book.steps || []).map((step, idx) => {
            const imgSrc = embeddedImages[idx] || '';
            const stepName = escapeTemplateHtml(step.name || `第 ${idx + 1} 幕`);
            const caption = escapeTemplateHtml(step.caption || '');
            const prompt = escapeTemplateHtml(step.prompt || '');

            return `
            <div class="webtoon-panel" id="panel-${idx + 1}">
                <div class="image-box">
                    <img src="${escapeTemplateHtml(imgSrc)}" alt="${stepName}" loading="lazy">
                    <div class="panel-num">#${idx + 1}</div>
                </div>
                ${caption ? `<div class="caption-bubble">${caption}</div>` : ''}
                ${showPrompts && prompt ? `<div class="prompt-hint"><code>${prompt}</code></div>` : ''}
            </div>`;
        }).join('\n');

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - 条漫版</title>
    <style>
        :root { --primary: ${themeColor}; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #07090e; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }
        .webtoon-scroll-container { width: 100%; max-width: 680px; padding: 0 0 80px 0; background: #0c1017; box-shadow: 0 0 50px rgba(0,0,0,0.8); }
        .webtoon-header { padding: 48px 24px 32px; text-align: center; border-bottom: 1px solid #1e293b; }
        .badge-tag { display: inline-block; font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--primary); background: rgba(99,102,241,0.15); padding: 4px 12px; border-radius: 999px; margin-bottom: 12px; border: 1px solid rgba(99,102,241,0.3); }
        h1 { font-size: 26px; font-weight: 800; margin-bottom: 10px; color: #fff; line-height: 1.3; }
        .synopsis { font-size: 14px; color: #94a3b8; line-height: 1.6; max-width: 520px; margin: 0 auto; }
        .character-info { font-size: 12px; color: #64748b; margin-top: 12px; }
        .webtoon-panel { position: relative; margin: 0; padding: 0; width: 100%; }
        .image-box { position: relative; width: 100%; line-height: 0; background: #000; }
        .image-box img { width: 100%; height: auto; display: block; object-fit: contain; }
        .panel-num { position: absolute; top: 12px; right: 12px; font-size: 11px; font-family: monospace; background: rgba(0,0,0,0.65); color: #e2e8f0; padding: 3px 8px; border-radius: 6px; backdrop-filter: blur(4px); line-height: 1; }
        .caption-bubble { padding: 18px 24px; font-size: 15px; line-height: 1.7; color: #e2e8f0; background: #0f172a; border-left: 3px solid var(--primary); margin: 0 0 24px 0; font-weight: 500; }
        .prompt-hint { padding: 8px 20px 20px; font-size: 11px; color: #64748b; word-break: break-all; }
        .webtoon-footer { padding: 40px 20px; text-align: center; color: #64748b; font-size: 12px; border-top: 1px solid #1e293b; }
        .progress-bar { position: fixed; top: 0; left: 0; height: 3px; background: var(--primary); z-index: 100; transition: width 0.1s; }
        @media (max-width: 640px) { h1 { font-size: 20px; } .caption-bubble { font-size: 14px; padding: 14px 18px; } }
    </style>
</head>
<body>
    <div class="progress-bar" id="progressBar"></div>
    <main class="webtoon-scroll-container">
        <header class="webtoon-header">
            <span class="badge-tag">Webtoon 条漫全彩</span>
            <h1>${title}</h1>
            ${synopsis ? `<p class="synopsis">${synopsis}</p>` : ''}
            ${character ? `<p class="character-info">主角设定：${character}</p>` : ''}
        </header>
        ${panelsHtml}
        <footer class="webtoon-footer">
            <p>Generated with Mio · 全屏离线阅读本</p>
        </footer>
    </main>
    <script>
        window.addEventListener('scroll', () => {
            const h = document.documentElement.scrollHeight - window.innerHeight;
            const progress = h > 0 ? (window.scrollY / h) * 100 : 0;
            document.getElementById('progressBar').style.width = Math.min(100, Math.max(0, progress)) + '%';
        });
    </script>
</body>
</html>`;
    },

    /**
     * 2. Manga Grid 日漫多格版式
     */
    manga_grid(book, embeddedImages, options = {}) {
        const title = escapeTemplateHtml(book.title || '日漫连环画');
        const synopsis = escapeTemplateHtml(book.synopsis || '');
        const showPrompts = !!options.showPrompts;

        const panelsHtml = (book.steps || []).map((step, idx) => {
            const imgSrc = embeddedImages[idx] || '';
            const stepName = escapeTemplateHtml(step.name || `第 ${idx + 1} 幕`);
            const caption = escapeTemplateHtml(step.caption || '');
            const prompt = escapeTemplateHtml(step.prompt || '');
            // 每第 1 格或第 4 格设为大特写破格样式
            const isWide = (idx % 5 === 0);

            return `
            <article class="manga-frame ${isWide ? 'span-wide' : ''}">
                <div class="manga-gutter">
                    <img src="${escapeTemplateHtml(imgSrc)}" alt="${stepName}" loading="lazy">
                    <span class="manga-badge">${idx + 1}</span>
                </div>
                ${caption ? `<div class="manga-dialogue">${caption}</div>` : ''}
                ${showPrompts && prompt ? `<div class="manga-prompt"><code>${prompt}</code></div>` : ''}
            </article>`;
        }).join('\n');

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - 漫画分镜版</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #18181b; color: #f4f4f5; font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px 16px; display: flex; justify-content: center; }
        .manga-page { max-width: 1040px; width: 100%; background: #09090b; border: 3px solid #27272a; padding: 28px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
        .manga-header { border-bottom: 2px solid #27272a; padding-bottom: 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
        .manga-title { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; }
        .manga-meta { font-size: 12px; color: #a1a1aa; font-family: monospace; }
        .manga-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
        .manga-frame { background: #18181b; border: 2px solid #3f3f46; position: relative; display: flex; flex-direction: column; overflow: hidden; }
        .manga-frame.span-wide { grid-column: span 2; }
        .manga-gutter { position: relative; background: #000; width: 100%; }
        .manga-gutter img { width: 100%; height: auto; display: block; object-fit: cover; }
        .manga-badge { position: absolute; top: 10px; left: 10px; background: #000; color: #fff; font-weight: 900; font-size: 13px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; border-radius: 4px; }
        .manga-dialogue { padding: 14px 18px; font-size: 14px; line-height: 1.6; color: #f4f4f5; background: #1c1917; border-top: 1px solid #292524; font-weight: 500; }
        .manga-prompt { padding: 6px 14px 12px; font-size: 11px; color: #71717a; font-family: monospace; }
        @media (max-width: 720px) {
            .manga-grid { grid-template-columns: 1fr; }
            .manga-frame.span-wide { grid-column: span 1; }
            .manga-page { padding: 16px; border-width: 2px; }
        }
    </style>
</head>
<body>
    <div class="manga-page">
        <header class="manga-header">
            <div>
                <h1 class="manga-title">${title}</h1>
                ${synopsis ? `<p style="color:#a1a1aa; font-size:13px; margin-top:6px;">${synopsis}</p>` : ''}
            </div>
            <div class="manga-meta">${(book.steps || []).length} PANELS · COMIC STUDIO</div>
        </header>
        <section class="manga-grid">
            ${panelsHtml}
        </section>
    </div>
</body>
</html>`;
    },

    /**
     * 3. Artbook Lookbook 典雅艺术画册
     */
    artbook_lookbook(book, embeddedImages, options = {}) {
        const title = escapeTemplateHtml(book.title || '艺术画册');
        const synopsis = escapeTemplateHtml(book.synopsis || '');
        const character = escapeTemplateHtml(book.characterName || '');
        const showPrompts = !!options.showPrompts;

        const pagesHtml = (book.steps || []).map((step, idx) => {
            const imgSrc = embeddedImages[idx] || '';
            const stepName = escapeTemplateHtml(step.name || `Scene ${idx + 1}`);
            const caption = escapeTemplateHtml(step.caption || '');
            const prompt = escapeTemplateHtml(step.prompt || '');

            return `
            <div class="artbook-spread">
                <div class="artbook-visual">
                    <img src="${escapeTemplateHtml(imgSrc)}" alt="${stepName}" loading="lazy">
                </div>
                <div class="artbook-info">
                    <span class="artbook-index">PLATE ${String(idx + 1).padStart(2, '0')}</span>
                    <h3 class="artbook-name">${stepName}</h3>
                    ${caption ? `<p class="artbook-desc">${caption}</p>` : ''}
                    ${showPrompts && prompt ? `
                    <div class="artbook-metadata">
                        <span class="meta-label">PROMPT PARAMS</span>
                        <div class="meta-content">${prompt}</div>
                    </div>` : ''}
                </div>
            </div>`;
        }).join('\n');

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - 艺术画册</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f8fafc; color: #1e293b; font-family: "Playfair Display", Georgia, "Times New Roman", serif; padding: 60px 20px; display: flex; justify-content: center; }
        .artbook-container { max-width: 980px; width: 100%; }
        .artbook-cover { text-align: center; padding: 80px 20px 100px; border-bottom: 1px solid #e2e8f0; margin-bottom: 60px; }
        .artbook-cover-pre { font-family: -apple-system, sans-serif; font-size: 11px; letter-spacing: 4px; text-transform: uppercase; color: #64748b; margin-bottom: 16px; font-weight: 600; }
        .artbook-cover-title { font-size: 40px; font-weight: 400; color: #0f172a; margin-bottom: 20px; line-height: 1.2; }
        .artbook-cover-desc { font-family: -apple-system, sans-serif; font-size: 15px; color: #64748b; max-width: 560px; margin: 0 auto; line-height: 1.7; }
        .artbook-spread { display: grid; grid-template-columns: 1.3fr 1fr; gap: 48px; align-items: center; margin-bottom: 90px; background: #fff; padding: 36px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); border: 1px solid #f1f5f9; }
        .artbook-spread:nth-child(even) { grid-template-columns: 1fr 1.3fr; }
        .artbook-spread:nth-child(even) .artbook-visual { order: 2; }
        .artbook-visual img { width: 100%; height: auto; display: block; border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
        .artbook-info { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .artbook-index { display: block; font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #94a3b8; margin-bottom: 10px; }
        .artbook-name { font-family: "Playfair Display", Georgia, serif; font-size: 24px; font-weight: 600; color: #0f172a; margin-bottom: 16px; }
        .artbook-desc { font-size: 15px; color: #475569; line-height: 1.8; margin-bottom: 24px; }
        .artbook-metadata { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; font-size: 11px; }
        .meta-label { font-weight: 700; color: #94a3b8; font-size: 9px; letter-spacing: 1px; display: block; margin-bottom: 4px; }
        .meta-content { color: #64748b; font-family: monospace; word-break: break-all; }
        @media (max-width: 768px) {
            .artbook-spread, .artbook-spread:nth-child(even) { grid-template-columns: 1fr; gap: 24px; padding: 20px; }
            .artbook-spread:nth-child(even) .artbook-visual { order: 1; }
            .artbook-cover-title { font-size: 28px; }
        }
    </style>
</head>
<body>
    <div class="artbook-container">
        <header class="artbook-cover">
            <div class="artbook-cover-pre">VISUAL PORTFOLIO & LOOKBOOK</div>
            <h1 class="artbook-cover-title">${title}</h1>
            ${character ? `<div class="artbook-cover-pre" style="color:#0f172a;">FEATURING · ${character}</div>` : ''}
            ${synopsis ? `<p class="artbook-cover-desc">${synopsis}</p>` : ''}
        </header>
        <main>
            ${pagesHtml}
        </main>
    </div>
</body>
</html>`;
    },

    /**
     * 4. 3D Flipbook 拟真翻页书
     */
    flipbook_3d(book, embeddedImages, options = {}) {
        const title = escapeTemplateHtml(book.title || '3D 翻页漫画');
        const synopsis = escapeTemplateHtml(book.synopsis || '');

        const pagesData = (book.steps || []).map((step, idx) => ({
            num: idx + 1,
            name: step.name || `第 ${idx + 1} 幕`,
            caption: step.caption || '',
            image: embeddedImages[idx] || ''
        }));

        const serializedData = JSON.stringify(pagesData).replace(/</g, '\\u003c');

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - 3D 翻页书</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; overflow-x: hidden; }
        .flipbook-scene { perspective: 1600px; width: min(880px, 94vw); height: min(600px, 80vh); display: flex; justify-content: center; align-items: center; margin: 20px 0; }
        .book-container { width: 100%; height: 100%; display: flex; background: #1e293b; border-radius: 12px; box-shadow: 0 25px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05); overflow: hidden; position: relative; }
        .book-spine { position: absolute; left: 50%; top: 0; bottom: 0; width: 4px; background: linear-gradient(to right, rgba(0,0,0,0.6), transparent, rgba(0,0,0,0.6)); z-index: 10; transform: translateX(-50%); box-shadow: 0 0 12px rgba(0,0,0,0.8); }
        .book-page-half { flex: 1; height: 100%; display: flex; flex-direction: column; background: #090d16; padding: 24px; position: relative; overflow: hidden; }
        .left-page { border-right: 1px solid #1e293b; justify-content: center; align-items: center; }
        .right-page { justify-content: center; align-items: center; }
        .page-img-wrap { width: 100%; height: 75%; display: flex; align-items: center; justify-content: center; background: #000; border-radius: 8px; overflow: hidden; }
        .page-img-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .page-text { height: 25%; width: 100%; padding-top: 14px; display: flex; flex-direction: column; justify-content: flex-start; }
        .page-badge { font-size: 11px; font-weight: 700; color: #818cf8; font-family: monospace; margin-bottom: 4px; }
        .page-caption { font-size: 14px; line-height: 1.5; color: #cbd5e1; overflow-y: auto; }
        .controls { display: flex; align-items: center; gap: 20px; z-index: 20; }
        button { background: #334155; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.15s; }
        button:hover { background: #475569; }
        button:disabled { opacity: 0.3; cursor: not-allowed; }
        .page-indicator { font-size: 13px; color: #94a3b8; font-family: monospace; }
        .shortcuts-hint { margin-top: 10px; font-size: 11px; color: #64748b; }
        @media (max-width: 640px) {
            .flipbook-scene { height: 70vh; }
            .book-container { flex-direction: column; }
            .left-page { border-right: none; border-bottom: 1px solid #1e293b; }
            .book-spine { display: none; }
        }
    </style>
</head>
<body>
    <div class="flipbook-scene">
        <div class="book-container">
            <div class="book-spine"></div>
            <div class="book-page-half left-page" id="leftPage"></div>
            <div class="book-page-half right-page" id="rightPage"></div>
        </div>
    </div>
    <div class="controls">
        <button id="prevBtn" onclick="prevSpread()">上一页 (←)</button>
        <span class="page-indicator" id="pageIndicator">1 / 1</span>
        <button id="nextBtn" onclick="nextSpread()">下一页 (→)</button>
    </div>
    <div class="shortcuts-hint">支持使用键盘方向键 ← / → 翻页 · ${title}</div>

    <script>
        const pages = ${serializedData};
        let currentSpread = 0;
        const totalSpreads = Math.ceil(pages.length / 2);

        function esc(str) {
            const s = String(str || '');
            if (/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
            return s
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function renderSpread() {
            const leftIdx = currentSpread * 2;
            const rightIdx = leftIdx + 1;

            const renderHalf = (el, p) => {
                if (!p) {
                    el.innerHTML = '<div style="color:#475569; font-size:13px;">- 封底 / 空白 -</div>';
                    return;
                }
                el.innerHTML = \`
                    <div class="page-img-wrap">
                        <img src="\${esc(p.image)}" alt="\${esc(p.name)}">
                    </div>
                    <div class="page-text">
                        <div class="page-badge">第 \${esc(p.num)} 幕 · \${esc(p.name)}</div>
                        <div class="page-caption">\${esc(p.caption || '')}</div>
                    </div>
                \`;
            };

            renderHalf(document.getElementById('leftPage'), pages[leftIdx]);
            renderHalf(document.getElementById('rightPage'), pages[rightIdx]);

            document.getElementById('pageIndicator').textContent = \`\${currentSpread + 1} / \${Math.max(1, totalSpreads)}\`;
            document.getElementById('prevBtn').disabled = currentSpread <= 0;
            document.getElementById('nextBtn').disabled = currentSpread >= totalSpreads - 1;
        }

        function prevSpread() {
            if (currentSpread > 0) {
                currentSpread--;
                renderSpread();
            }
        }

        function nextSpread() {
            if (currentSpread < totalSpreads - 1) {
                currentSpread++;
                renderSpread();
            }
        }

        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') prevSpread();
            if (e.key === 'ArrowRight') nextSpread();
        });

        renderSpread();
    </script>
</body>
</html>`;
    }
};

window.ComicTemplateGenerators = ComicTemplateGenerators;

/**
 * 组装并导出画册 HTML
 */
async function generateComicHTML(book, templateId = 'webtoon', options = {}) {
    if (!book || !Array.isArray(book.steps) || book.steps.length === 0) {
        throw new Error("画册数据为空或分镜列表不存在");
    }

    // 关键排序与有效性契约：优先按 stepIndex 排序，防御断点续画导致的顺序错乱
    const rawSteps = Array.isArray(book.steps) ? book.steps.filter(step => step && typeof step === 'object') : [];
    const orderedSteps = (typeof window.getOrderedBookSteps === 'function')
        ? window.getOrderedBookSteps(book).filter(step => step && typeof step === 'object')
        : rawSteps.slice().sort((a, b) => {
            const aIdx = Number.isInteger(a.stepIndex) ? a.stepIndex : 0;
            const bIdx = Number.isInteger(b.stepIndex) ? b.stepIndex : 0;
            return aIdx - bIdx;
        });

    if (orderedSteps.length === 0) {
        throw new Error("有效分镜列表为空");
    }

    const sortedBook = {
        ...book,
        steps: orderedSteps
    };

    const toBase64 = (typeof window !== 'undefined' && window.imageSourceToBase64DataUrl)
        ? window.imageSourceToBase64DataUrl
        : (typeof imageSourceToBase64DataUrl === 'function' ? imageSourceToBase64DataUrl : async s => s);
    const placeholder = (typeof window !== 'undefined' && window.OFFLINE_PLACEHOLDER_IMAGE) ? window.OFFLINE_PLACEHOLDER_IMAGE : '';

    // 将所有分镜图像转化为离线嵌入的 Base64 Data URL（确保 fallback 占位图也转为标准 Data URL，不留裸双引号）
    const embeddedImages = await Promise.all(
        orderedSteps.map(step => toBase64((step && step.image) ? step.image : placeholder))
    );

    const generator = ComicTemplateGenerators[templateId] || ComicTemplateGenerators.webtoon;
    return generator(sortedBook, embeddedImages, options);
}

window.generateComicHTML = generateComicHTML;
