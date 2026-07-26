// js/gallery.js - 画廊展厅、沉浸式画册阅读器、单页重绘与离线导出。

// --- TAB 1: PIXIV GALLERY RENDERING ---
function getGalleryRelationKey(book) {
    if (!book) return '';
    if (book.rowId && book.templateId) {
        return `row:${book.rowId}|tpl:${book.templateId}`;
    }
    return `title:${book.title || ''}|tplTitle:${book.templateTitle || ''}|character:${book.characterName || ''}`;
}

function getRelatedGalleryBooks(book) {
    const relationKey = getGalleryRelationKey(book);
    if (!relationKey) return book ? [book] : [];

    return savedGalleries
        .filter(item => getGalleryRelationKey(item) === relationKey)
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}

function getBookCreatedLabel(book) {
    if (!book?.createdAt) return '旧画册';
    return `生成于 ${formatStoryVersionTime(book.createdAt)}`;
}

function getBookLikeCount(book) {
    const storedLikes = Number(book?.likes);
    if (Number.isInteger(storedLikes) && storedLikes >= 0) return storedLikes;

    const seed = String(book?.id || book?.title || 'comic');
    let hash = 0;
    for (let idx = 0; idx < seed.length; idx++) {
        hash = ((hash * 31) + seed.charCodeAt(idx)) >>> 0;
    }
    return 12 + (hash % 80);
}

function updateModalLikeButton(book) {
    const button = document.getElementById('modal-like-button');
    if (!button) return;
    const isLiked = !!book?.liked;
    button.setAttribute('aria-pressed', String(isLiked));
    button.title = isLiked ? '取消点赞' : '点赞收藏';
    button.classList.toggle('text-red-500', isLiked);
    button.classList.toggle('text-slate-500', !isLiked);
}

function renderGalleryStorySwitcher(book) {
    const wrap = document.getElementById('modal-story-switcher-wrap');
    const selector = document.getElementById('modal-story-switcher');
    if (!wrap || !selector) return;

    const relatedBooks = getRelatedGalleryBooks(book);
    if (relatedBooks.length <= 1) {
        wrap.classList.add('hidden');
        selector.innerHTML = '';
        return;
    }

    wrap.classList.remove('hidden');
    selector.innerHTML = '';
    relatedBooks.forEach((item, idx) => {
        const steps = Array.isArray(item.steps) ? item.steps : [];
        const totalFrames = item.totalSteps || steps.length || 0;
        const frameLabel = totalFrames ? `${steps.length}/${totalFrames}P` : `${steps.length}P`;
        const storyTitle = item.storyTitle || `剧情版本 ${idx + 1}`;
        const optionText = `${storyTitle} · ${frameLabel} · ${getBookCreatedLabel(item)}`;
        selector.insertAdjacentHTML('beforeend', `
            <option value="${escapeHtml(item.id)}">${escapeHtml(optionText)}</option>
        `);
    });
    selector.value = book.id;
}

function switchGalleryStory(bookId) {
    if (!bookId || bookId === activeBookId) return;
    openPixivModal(bookId);
}

function getOrderedBookStepEntries(book) {
    const steps = Array.isArray(book?.steps) ? book.steps : [];
    return steps
        .map((step, originalIndex) => ({ step, originalIndex }))
        .sort((a, b) => {
            const aIndex = Number.isInteger(a.step?.stepIndex) ? a.step.stepIndex : a.originalIndex;
            const bIndex = Number.isInteger(b.step?.stepIndex) ? b.step.stepIndex : b.originalIndex;
            return aIndex - bIndex;
        });
}

function getOrderedBookSteps(book) {
    return getOrderedBookStepEntries(book).map(item => item.step);
}

function resetPixivModalScroll() {
    const modal = document.getElementById('pixiv-modal');
    const scrollTargets = [
        modal,
        document.getElementById('modal-comic-strip'),
        modal?.querySelector('.flex-grow.overflow-y-auto')
    ];

    scrollTargets.forEach(target => {
        if (!target) return;
        target.scrollTop = 0;
        target.scrollLeft = 0;
    });
}

function renderGallery() {
    const container = document.getElementById('gallery-container');
    container.innerHTML = '';

    if (savedGalleries.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-16 text-center space-y-4">
                <div class="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                    <i data-lucide="image-off" class="w-8 h-8"></i>
                </div>
                <h4 class="font-bold text-slate-700 dark:text-slate-300">尚未生成任何连环画</h4>
                <p class="text-xs text-slate-400">前往“批量角色矩阵”或“模板配置”，一键批量生成精美插图故事！</p>
            </div>
        `;
        initLucide();
        return;
    }

    savedGalleries.forEach((book, index) => {
        const steps = getOrderedBookSteps(book);
        const coverImage = steps[0]?.image || OFFLINE_PLACEHOLDER_IMAGE;
        const totalFrames = book.totalSteps || steps.length || 0;
        const generatedFrames = steps.length;
        const isInProgress = book.inProgress || book.status === 'generating';
        const isCanceled = book.status === 'canceled';
        const isFailed = book.status === 'failed';
        const completionText = isInProgress
            ? `生成中 ${generatedFrames}/${totalFrames || '?'}`
            : isCanceled
                ? `已中断 ${generatedFrames}/${totalFrames || '?'}`
                : isFailed
                    ? `生成失败 ${generatedFrames}/${totalFrames || '?'}`
                    : "100% 完整";
        const frameBadgeText = totalFrames ? `${generatedFrames}/${totalFrames} P` : `${generatedFrames} P`;
        const storyLabel = book.storyTitle || '默认剧情';
        const statusBadge = isInProgress
            ? '<div class="absolute top-2 right-2 bg-amber-500 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow animate-pulse">生成中</div>'
            : isCanceled
                ? '<div class="absolute top-2 right-2 bg-red-600 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow">已中断</div>'
                : isFailed
                    ? '<div class="absolute top-2 right-2 bg-red-700 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow">失败</div>'
                    : '';

        const cardHtml = `
            <div onclick="openPixivModal(${inlineJsString(book.id)})" class="group bg-white dark:bg-slate-900 rounded-2xl overflow-hidden pixiv-card-shadow border border-slate-100 dark:border-slate-800 hover:scale-[1.02] transition-all duration-300 cursor-pointer flex flex-col justify-between h-[360px] relative">
                <!-- Cover Image and frame indicator badge -->
                <div class="relative h-[220px] overflow-hidden bg-slate-950">
                    <img src="${escapeHtml(coverImage)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="Cover">
                    <div class="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                        <i data-lucide="layers" class="w-3 h-3"></i>
                        <span>${frameBadgeText}</span>
                    </div>
                    <div class="absolute top-2 left-2 bg-blue-600 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow">
                        ${escapeHtml(book.characterName)}
                    </div>
                    ${statusBadge}
                    <!-- 删除按钮：悬停时显示，阻止冒泡防止打开画册 -->
                    <button
                        onclick="event.stopPropagation(); deleteGallery(${inlineJsString(book.id)})"
                        class="absolute ${statusBadge ? 'top-9' : 'top-2'} right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-7 h-7 rounded-full bg-red-600/90 hover:bg-red-500 backdrop-blur-md flex items-center justify-center shadow-lg border border-red-400/30"
                        title="删除这本画册"
                    >
                        <i data-lucide="trash-2" class="w-3.5 h-3.5 text-white"></i>
                    </button>
                </div>

                <!-- Card metadata -->
                <div class="p-4 flex-grow flex flex-col justify-between space-y-2">
                    <div>
                        <h3 class="font-black text-sm text-slate-900 dark:text-slate-100 line-clamp-1 group-hover:text-blue-500 transition-colors">
                            ${escapeHtml(book.title)}
                        </h3>
                        <p class="text-[11px] text-slate-400 mt-0.5 font-mono">
                            模板: ${escapeHtml(book.templateTitle)}
                        </p>
                        <p class="text-[11px] text-purple-500 dark:text-purple-300 mt-0.5 font-semibold line-clamp-1">
                            剧情: ${escapeHtml(storyLabel)}
                        </p>
                    </div>
                    
                    <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                        ${escapeHtml(book.synopsis || "暂无剧本介绍。")}
                    </p>

                    <div class="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-2 text-[10px] text-slate-400">
                        <span class="flex items-center gap-1">
                            <i data-lucide="heart" class="w-3.5 h-3.5 text-pink-500 ${book.liked ? 'fill-pink-500' : 'fill-pink-500/20'}"></i>
                            <span>${getBookLikeCount(book)} 赞</span>
                        </span>
                        <span>${completionText}</span>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', cardHtml);
    });
    initLucide();
}

// 删除指定画册
function deleteGallery(bookId) {
    const book = savedGalleries.find(b => b.id === bookId);
    if (!book) return;
    if (!confirm(`确定要删除「${book.title}」吗？\n此操作不可撤销。`)) return;
    savedGalleries = savedGalleries.filter(b => b.id !== bookId);
    saveGalleriesToStorage(false, true);
    renderGallery();
    addLog(`已删除画册：${book.title}`);
}

// Immersive modal viewer
function openPixivModal(bookId) {
    const book = savedGalleries.find(b => b.id === bookId);
    if (!book) return;

    activeBookId = bookId; // cache selected
    resetPixivModalScroll();
    updateModalLikeButton(book);
    
    document.getElementById('modal-title').innerText = book.title;
    document.getElementById('modal-synopsis').innerText = book.synopsis || "暂无全局剧情。";
    const createdAtEl = document.getElementById('modal-created-at');
    if (createdAtEl) createdAtEl.innerText = getBookCreatedLabel(book);
    
    // Render tags
    const tagsContainer = document.getElementById('modal-tags');
    tagsContainer.innerHTML = '';
    const allTags = book.tags || ["AI漫画", "ComfyUI", "批量绘图"];
    allTags.forEach(t => {
        tagsContainer.insertAdjacentHTML('beforeend', `
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">#${escapeHtml(t)}</span>
        `);
    });
    renderGalleryStorySwitcher(book);

    // Render scrolling strip
    const stripContainer = document.getElementById('modal-comic-strip');
    stripContainer.innerHTML = `
        <!-- Floating Back Button (Top-left, Pixiv style) -->
        <button onclick="closePixivModal()" class="sticky top-4 left-4 z-20 px-4 py-2.5 rounded-full bg-slate-900/80 backdrop-blur-md text-white hover:bg-slate-800 border border-white/10 shadow-xl flex items-center gap-2 transition cursor-pointer select-none">
            <i data-lucide="arrow-left" class="w-4 h-4"></i>
            <span class="text-xs font-bold tracking-wide">返回画廊</span>
        </button>
    `;
    
    // Render narratives summary list in sidepanel
    const narrativesList = document.getElementById('modal-narratives-list');
    narrativesList.innerHTML = '';

    const orderedStepEntries = getOrderedBookStepEntries(book);
    orderedStepEntries.forEach(({ step, originalIndex }, idx) => {
        const stepImage = step.image || OFFLINE_PLACEHOLDER_IMAGE;
        
        // Parse and clean step image url to prevent Windows local path backslash encoding issues
        let cleanImageSrc = stepImage.trim();
        if (cleanImageSrc.startsWith("C:") || cleanImageSrc.startsWith("c:")) {
            cleanImageSrc = "file:///" + cleanImageSrc.replace(/\\/g, "/");
        }

        // Add to main strip (Left panel) - Clean borderless image scroll with floating caption overlay
        const stripCard = `
            <div class="pixiv-manga-card relative">
                <!-- Pure image view -->
                <div class="pixiv-image-frame">
                    <img src="${escapeHtml(cleanImageSrc)}" alt="${escapeHtml(step.name)}" onerror="this.onerror=null; this.src=window.OFFLINE_PLACEHOLDER_IMAGE;">
                    
                    <!-- Top Float Index Badge -->
                    <div class="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-white text-xs font-mono font-bold border border-white/10 shadow-lg select-none">
                        P${idx + 1}
                    </div>
                </div>

                <!-- Floating Caption Bar Overlay (Bottom-anchored, translucent) -->
                <div class="absolute bottom-0 inset-x-0 bg-black/70 backdrop-blur-sm p-4 border-t border-white/5 text-center">
                    <p class="text-xs font-semibold text-white tracking-wide leading-relaxed">
                        ${escapeHtml(step.caption || "（尚未生成旁白）")}
                    </p>
                </div>
            </div>
        `;
        stripContainer.insertAdjacentHTML('beforeend', stripCard);

        // Add to Sidepanel list (Right panel) - Expandable Accordion cards for captions and redraw control
        const listCard = `
            <div class="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-900/40">
                <!-- Header trigger -->
                <button onclick="toggleSidebarAccordion(${inlineJsString(book.id)}, ${originalIndex})" class="w-full p-3 flex items-start gap-2.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800/40 transition">
                    <span class="w-5 h-5 rounded-full bg-blue-500/10 text-blue-500 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">${idx + 1}</span>
                    <div class="flex-grow space-y-0.5 min-w-0">
                        <div class="flex justify-between items-center">
                            <h5 class="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">${escapeHtml(step.name)}</h5>
                            <i data-lucide="chevron-down" id="accordion-arrow-${escapeHtml(book.id)}-${originalIndex}" class="w-3.5 h-3.5 text-slate-400 transition-transform duration-200"></i>
                        </div>
                        <p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">${escapeHtml(step.caption || "尚未填充旁白。")}</p>
                    </div>
                </button>

                <!-- Expandable details pane -->
                <div id="accordion-pane-${escapeHtml(book.id)}-${originalIndex}" class="hidden p-3.5 border-t border-slate-200/60 dark:border-slate-800/60 bg-white dark:bg-slate-950/40 space-y-3">
                    <div class="space-y-1">
                        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">旁白文案：</span>
                        <p class="text-xs font-medium text-slate-800 dark:text-slate-200 leading-relaxed bg-slate-50 dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800/60">${escapeHtml(step.caption || "（空）")}</p>
                    </div>

                    <div class="space-y-1">
                        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">图像生成提示词：</span>
                        <p class="text-[10px] font-mono bg-slate-950 text-slate-400 p-3 rounded-lg border border-slate-800 break-all select-text leading-normal">${escapeHtml(step.prompt)}</p>
                    </div>

                    <!-- Single page redraw control trigger -->
                    <div class="flex justify-end pt-1">
                        <button onclick="toggleSingleRedrawPanel(${inlineJsString(book.id)}, ${originalIndex})" class="py-1 px-3 rounded-lg bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 text-blue-500 dark:text-blue-400 text-[10px] font-bold flex items-center gap-1.5 transition">
                            <i data-lucide="edit-3" class="w-3 h-3"></i> 单页精修重绘
                        </button>
                    </div>

                    <!-- Redraw form subpanel -->
                    <div id="redraw-panel-${escapeHtml(book.id)}-${originalIndex}" class="hidden p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5">
                        <label class="block text-[10px] text-slate-400 font-bold">精修该分镜提示词：</label>
                        <textarea id="redraw-prompt-${escapeHtml(book.id)}-${originalIndex}" class="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-xs focus:outline-none font-mono focus:border-blue-500 transition text-slate-800 dark:text-slate-200" rows="3">${escapeHtml(step.prompt)}</textarea>
                        <div class="flex justify-end gap-1.5">
                            <button onclick="toggleSingleRedrawPanel(${inlineJsString(book.id)}, ${originalIndex})" class="px-2.5 py-1 text-[10px] bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 font-bold transition">取消</button>
                            <button onclick="executeSingleRedraw(${inlineJsString(book.id)}, ${originalIndex})" class="px-2.5 py-1 text-[10px] bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center gap-1 transition">
                                <i data-lucide="play" class="w-3.5 h-3.5"></i> 确认重绘
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        narrativesList.insertAdjacentHTML('beforeend', listCard);
    });

    // Display modal
    const modal = document.getElementById('pixiv-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    resetPixivModalScroll();
    requestAnimationFrame(resetPixivModalScroll);
    initLucide();
}

function closePixivModal() {
    const modal = document.getElementById('pixiv-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

let activeBookId = null;
function likeCurrentBook() {
    const book = savedGalleries.find(item => item.id === activeBookId);
    if (!book) return;

    const wasLiked = !!book.liked;
    book.liked = !wasLiked;
    book.likes = Math.max(0, getBookLikeCount(book) + (book.liked ? 1 : -1));
    book.updatedAt = Date.now();
    saveGalleriesToStorage();
    renderGallery();
    updateModalLikeButton(book);
}

async function shareCurrentBook() {
    const book = savedGalleries.find(item => item.id === activeBookId);
    if (!book) return;

    const shareText = [
        book.title || '未命名画册',
        book.synopsis || '',
        `共 ${Array.isArray(book.steps) ? book.steps.length : 0} 幕`
    ].filter(Boolean).join('\n');

    try {
        if (navigator.share) {
            await navigator.share({ title: book.title || 'ComfyComic Studio 画册', text: shareText });
            return;
        }
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(shareText);
        alert('画册信息已复制到剪贴板。');
    } catch (err) {
        if (err?.name === 'AbortError') return;
        console.warn('[Gallery] 分享失败:', err.message);
        alert('无法调用系统分享或剪贴板，请稍后重试。');
    }
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('图片编码失败'));
        reader.readAsDataURL(blob);
    });
}

function normalizeImageSourceForExport(src) {
    const raw = String(src || '').trim();
    if (/^[a-zA-Z]:[\\/]/.test(raw)) {
        return `file:///${raw.replace(/\\/g, '/')}`;
    }
    return raw;
}

// 页面由本地服务提供时一律走同源相对路径，端口改成什么都不用动代码；
// 只有直接双击 index.html（file:// 兜底）时才需要写死一个默认端口。
const FILE_PROTOCOL_FALLBACK_ORIGIN = 'http://127.0.0.1:8777';
function getLocalBackendUrl(path) {
    return window.location.protocol.startsWith('http') ? path : `${FILE_PROTOCOL_FALLBACK_ORIGIN}${path}`;
}
window.getLocalBackendUrl = getLocalBackendUrl;

async function ensureBase64DataUrl(dataUrl) {
    if (/^data:[^,]+;base64,/i.test(dataUrl)) return dataUrl;
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return blobToDataUrl(blob);
}

async function imageSourceToBase64DataUrl(src) {
    const imageSrc = normalizeImageSourceForExport(src);
    if (!imageSrc) return ensureBase64DataUrl(OFFLINE_PLACEHOLDER_IMAGE);
    if (imageSrc.startsWith('data:')) {
        return ensureBase64DataUrl(imageSrc);
    }

    try {
        const response = await fetch(getLocalBackendUrl('/api/inline-image'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: imageSrc })
        });
        if (response.ok) {
            const payload = await response.json();
            if (payload.dataUrl) return payload.dataUrl;
        }
    } catch (err) {
        console.warn('[Export] Backend image inlining failed, trying browser fetch:', err.message);
    }

    try {
        const response = await fetch(imageSrc, { cache: 'no-store' });
        if (!response.ok) throw new Error(`图片请求失败：${response.status}`);
        return blobToDataUrl(await response.blob());
    } catch (err) {
        console.warn('[Export] Image fallback placeholder used:', imageSrc, err.message);
        return ensureBase64DataUrl(OFFLINE_PLACEHOLDER_IMAGE);
    }
}

// Export Manga as simple single page html file
async function exportMangaHTML() {
    const book = savedGalleries.find(b => b.id === activeBookId);
    if (!book) return;

    const exportBtn = document.querySelector("button[onclick='exportMangaHTML()']");
    const originalBtnHtml = exportBtn?.innerHTML || '';
    if (exportBtn) {
        exportBtn.disabled = true;
        exportBtn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> 正在打包图片...`;
        initLucide(exportBtn);
    }

    let stepsHTML = '';
    try {
        const steps = Array.isArray(book.steps) ? book.steps : [];
        const embeddedImages = await Promise.all(steps.map(step => imageSourceToBase64DataUrl(step.image)));

        steps.forEach((step, idx) => {
            stepsHTML += `
                <div class="step-card">
                    <div class="image-wrap">
                        <img src="${escapeHtml(embeddedImages[idx])}" alt="${escapeHtml(step.name || `第 ${idx + 1} 幕`)}">
                        <div class="badge">第 ${idx + 1} 幕 · ${escapeHtml(step.name || '')}</div>
                    </div>
                    <div class="caption">${escapeHtml(step.caption || '')}</div>
                </div>
            `;
        });

        const templateContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(book.title)} - ComfyComic 离线漫画本</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b0f19; color: #f1f5f9; text-align: center; margin: 0; padding: 40px 20px; }
        .manga-container { width: min(920px, 100%); margin: 0 auto; display: flex; flex-direction: column; gap: 40px; }
        .header { margin-bottom: 20px; border-bottom: 1px solid #1e293b; padding-bottom: 20px; }
        h1 { font-size: 28px; margin: 0 0 10px; color: #3b82f6; }
        p { color: #94a3b8; font-size: 14px; }
        .step-card { background: #111827; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); }
        .image-wrap { position: relative; background: #020617; display: flex; align-items: center; justify-content: center; }
        img { width: 100%; height: auto; display: block; object-fit: contain; }
        .badge { position: absolute; top: 15px; left: 15px; background: rgba(0,0,0,0.7); padding: 5px 12px; font-size: 12px; border-radius: 6px; font-weight: bold; }
        .caption { padding: 20px; font-size: 16px; line-height: 1.6; font-weight: 500; text-align: left; }
        @media (max-width: 640px) { body { padding: 24px 12px; } h1 { font-size: 22px; } .caption { font-size: 14px; } }
    </style>
</head>
<body>
    <div class="manga-container">
        <div class="header">
            <h1>${escapeHtml(book.title)}</h1>
            <p>${escapeHtml(book.synopsis || '')}</p>
        </div>
        ${stepsHTML}
    </div>
</body>
</html>`;

        const blob = new Blob([templateContent], { type: 'text/html;charset=utf-8' });
        const link = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        link.download = `${book.title}_离线漫画分享.html`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
        alert(`打包下载失败：${err.message}`);
    } finally {
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.innerHTML = originalBtnHtml;
            initLucide(exportBtn);
        }
    }
}

// Delete book directly from modal
function deleteCurrentBook() {
    if (!activeBookId) return;
    const book = savedGalleries.find(b => b.id === activeBookId);
    if (!book) return;

    if (confirm(`确定要彻底删除画册「${book.title}」吗？\n该操作不可逆，将永久移除本地数据。`)) {
        savedGalleries = savedGalleries.filter(b => b.id !== activeBookId);
        saveGalleriesToStorage(false, true);
        closePixivModal();
        renderGallery();
        alert("画册已彻底删除！");
    }
}

// Single step / single page panel redraw controllers with viewport alignment optimization
function toggleSingleRedrawPanel(bookId, stepIdx) {
    const panel = document.getElementById(`redraw-panel-${bookId}-${stepIdx}`);
    if (panel) {
        const isCollapsed = panel.classList.contains('hidden');
        panel.classList.toggle('hidden');
        
        // Auto smooth scroll to reveal the input form if it is expanded
        if (isCollapsed) {
            setTimeout(() => {
                const scrollContainer = document.getElementById('modal-narratives-list')?.parentElement?.parentElement;
                if (scrollContainer) {
                    scrollContainer.scrollBy({
                        top: 170,
                        behavior: 'smooth'
                    });
                }
            }, 100);
        }
    }
}

async function executeSingleRedraw(bookId, stepIdx) {
    const book = savedGalleries.find(b => b.id === bookId);
    if (!book) return;

    const promptText = document.getElementById(`redraw-prompt-${bookId}-${stepIdx}`).value.trim();
    if (!promptText) {
        alert("提示词不能为空！");
        return;
    }

    const btn = document.querySelector(`#redraw-panel-${bookId}-${stepIdx} button[onclick*='executeSingleRedraw']`);
    const origText = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> 绘制中...`;
    initLucide();
    btn.disabled = true;

    try {
        let newImgUrl = "";
        if (!isMockMode) {
            // Submit single prompt queue to ComfyUI
            newImgUrl = await submitToRealComfy(promptText);
        } else {
            // Mock single step image redraw delay
            await sleep(1500);
            newImgUrl = getMockVisual(promptText, stepIdx + 8, book.steps[stepIdx]?.name || "");
        }

        // Apply new render states
        book.steps[stepIdx].image = newImgUrl;
        book.steps[stepIdx].prompt = promptText;
        
        saveGalleriesToStorage();
        renderGallery();
        
        // Hot refresh modal viewer
        openPixivModal(bookId);
    } catch (err) {
        alert("重新绘制失败: " + err.message);
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
        initLucide();
    }
}

// Toggle sidebar narratives accordion panels with high-fidelity smooth scroll focus
function toggleSidebarAccordion(bookId, idx) {
    const pane = document.getElementById(`accordion-pane-${bookId}-${idx}`);
    const arrow = document.getElementById(`accordion-arrow-${bookId}-${idx}`);
    if (!pane) return;

    const isHidden = pane.classList.contains('hidden');
    
    // Close other panes first to keep sidebar compact
    const allPanes = document.querySelectorAll(`[id^="accordion-pane-${bookId}-"]`);
    const allArrows = document.querySelectorAll(`[id^="accordion-arrow-${bookId}-"]`);
    allPanes.forEach(p => p.classList.add('hidden'));
    allArrows.forEach(a => a.style.transform = 'rotate(0deg)');

    if (isHidden) {
        pane.classList.remove('hidden');
        if (arrow) arrow.style.transform = 'rotate(180deg)';
        
        // Auto smooth-scroll focused card into view center
        setTimeout(() => {
            const scrollContainer = document.getElementById('modal-narratives-list')?.parentElement?.parentElement;
            const cardEl = pane.parentElement;
            if (scrollContainer && cardEl) {
                const targetTop = cardEl.offsetTop - 60;
                scrollContainer.scrollTo({
                    top: Math.max(0, targetTop),
                    behavior: 'smooth'
                });
            }
        }, 100);
    }
}
