// js/gallery.js - 画廊展厅、沉浸式画册阅读器、单页重绘与离线导出。

// --- TAB 1: PIXIV GALLERY RENDERING ---

// 画廊检索：批量跑几轮之后画册数量很容易上百，没有检索就只能靠滚动找。
// 状态保存在内存里，刷新页面回到默认视图。
const galleryView = { query: '', status: 'all', sort: 'newest' };

function onGalleryFilterChange() {
    galleryView.query = String(getElementValue('gallery-search-input', '') || '').trim().toLowerCase();
    galleryView.status = getElementValue('gallery-status-filter', 'all') || 'all';
    galleryView.sort = getElementValue('gallery-sort-select', 'newest') || 'newest';
    renderGallery();
}

function getBookSearchHaystack(book) {
    if (book._searchIndex && book._searchStamp === book.updatedAt) return book._searchIndex;
    const parts = [
        book.title, book.characterName, book.templateTitle, book.storyTitle,
        book.synopsis, (book.tags || []).join(' ')
    ];
    (book.steps || []).forEach(step => {
        parts.push(step.name, step.caption);
    });
    const index = parts.filter(Boolean).join(' ').toLowerCase();
    // 缓存到画册对象上；updatedAt 变了才重算，避免每次输入都重扫全部分镜。
    Object.defineProperty(book, '_searchIndex', { value: index, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(book, '_searchStamp', { value: book.updatedAt, writable: true, configurable: true, enumerable: false });
    return index;
}

function bookMatchesStatusFilter(book, status) {
    if (status === 'all') return true;
    if (status === 'liked') return !!book.liked;
    const isDone = !book.inProgress && book.status !== 'canceled' && book.status !== 'failed' && book.status !== 'generating';
    return status === 'complete' ? isDone : !isDone;
}

function getVisibleGalleryBooks() {
    const { query, status, sort } = galleryView;
    const filtered = savedGalleries.filter(book =>
        bookMatchesStatusFilter(book, status)
        && (!query || getBookSearchHaystack(book).includes(query))
    );

    const stepCount = (book) => (Array.isArray(book.steps) ? book.steps.length : 0);
    const created = (book) => Number(book.createdAt) || 0;
    if (sort === 'oldest') filtered.sort((a, b) => created(a) - created(b));
    else if (sort === 'title') filtered.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'));
    else if (sort === 'panels') filtered.sort((a, b) => stepCount(b) - stepCount(a));
    else filtered.sort((a, b) => created(b) - created(a));

    return filtered;
}

function renderGalleryResultCount(visibleCount) {
    const el = document.getElementById('gallery-result-count');
    if (!el) return;
    const total = savedGalleries.length;
    el.innerText = visibleCount === total ? `共 ${total} 本` : `${visibleCount} / ${total} 本`;
}
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
window.getOrderedBookSteps = getOrderedBookSteps;
window.getOrderedBookStepEntries = getOrderedBookStepEntries;

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

// 单张画册卡片的 HTML。抽出来是为了在批量出图过程中只重画受影响的那一张，
// 而不是每出一张图就整栅格重建 + 全局扫一遍图标。
function buildGalleryCardHtml(book) {
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

    // 未完成的画册：直接在卡片上给一个“继续补齐”的入口。
    const missingCount = getMissingPanelIndices(book).length;
    const resumeButton = (!isInProgress && missingCount > 0) ? `
                <button
                    onclick="event.stopPropagation(); resumeBookGeneration(${inlineJsString(book.id)})"
                    class="absolute bottom-2 left-2 px-2.5 py-1 rounded-lg bg-blue-600/95 hover:bg-blue-500 text-white text-[10px] font-bold flex items-center gap-1 shadow-lg border border-blue-400/30 transition"
                    title="只重跑缺失或失败的 ${missingCount} 幕，已完成的不动"
                >
                    <i data-lucide="refresh-cw" class="w-3 h-3"></i>
                    补齐 ${missingCount} 幕
                </button>` : '';

    const cardHtml = `
        <div data-book-id="${escapeHtml(book.id)}" onclick="openPixivModal(${inlineJsString(book.id)})" class="group bg-white dark:bg-slate-900 rounded-2xl overflow-hidden pixiv-card-shadow border border-slate-100 dark:border-slate-800 hover:scale-[1.02] transition-all duration-300 cursor-pointer flex flex-col justify-between h-[360px] relative">
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
                ${resumeButton}
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
    return cardHtml;
}

// 只替换某一本画册对应的那张卡片。批量出图时每完成一幕就调用它，
// 代替 renderGallery() —— 后者会重建全部卡片并对整个文档重跑一次图标渲染。
function refreshGalleryCard(bookId) {
    const book = savedGalleries.find(item => item.id === bookId);
    const card = document.querySelector(`#gallery-container [data-book-id="${CSS.escape(String(bookId))}"]`);
    if (!book || !card) {
        // 卡片还不在 DOM 里（比如刚创建，或被当前筛选条件挡住），退回整表重画。
        renderGallery();
        return;
    }
    card.outerHTML = buildGalleryCardHtml(book);
    const replaced = document.querySelector(`#gallery-container [data-book-id="${CSS.escape(String(bookId))}"]`);
    if (replaced) initLucide(replaced);
}

function renderGallery() {
    const container = document.getElementById('gallery-container');
    container.innerHTML = '';

    const visibleBooks = getVisibleGalleryBooks();
    renderGalleryResultCount(visibleBooks.length);

    if (savedGalleries.length > 0 && visibleBooks.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-16 text-center space-y-4">
                <div class="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                    <i data-lucide="search-x" class="w-8 h-8"></i>
                </div>
                <h4 class="font-bold text-slate-700 dark:text-slate-300">没有符合条件的画册</h4>
                <p class="text-xs text-slate-400">试试换个关键词，或把状态筛选改回“全部状态”。</p>
            </div>
        `;
        initLucide(container);
        return;
    }

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

    visibleBooks.forEach((book) => {
        container.insertAdjacentHTML('beforeend', buildGalleryCardHtml(book));
    });
    initLucide(container);
}

// 删除指定画册
async function deleteGallery(bookId) {
    const book = savedGalleries.find(b => b.id === bookId);
    if (!book) return;
    const confirmed = await confirmAction({
        title: '删除这本画册？',
        message: `「${book.title}」及其 ${Array.isArray(book.steps) ? book.steps.length : 0} 张已生成的分镜记录会被移除，且无法撤销。`,
        confirmText: '删除画册',
        danger: true
    });
    if (!confirmed) return;
    savedGalleries = savedGalleries.filter(b => b.id !== bookId);
    saveGalleriesToStorage(false, true);
    renderGallery();
    addLog(`已删除画册：${book.title}`);
    notify(`已删除画册「${book.title}」。`, { type: 'success' });
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
        if (/^[a-zA-Z]:[\\/]/.test(cleanImageSrc)) {
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

                    <!-- Actions: AI 视觉审校与单页重绘 -->
                    <div class="flex justify-end pt-1 gap-2">
                        <button onclick="auditStepFromAccordion(${inlineJsString(book.id)}, ${originalIndex})" id="btn-audit-${escapeHtml(book.id)}-${originalIndex}" class="py-1 px-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 text-[10px] font-bold flex items-center gap-1 transition">
                            <i data-lucide="scan-eye" class="w-3 h-3"></i> AI 视觉审校
                        </button>
                        <button onclick="toggleSingleRedrawPanel(${inlineJsString(book.id)}, ${originalIndex})" class="py-1 px-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 text-blue-500 dark:text-blue-400 text-[10px] font-bold flex items-center gap-1 transition">
                            <i data-lucide="edit-3" class="w-3 h-3"></i> 单页精修重绘
                        </button>
                    </div>

                    <!-- AI 视觉审校结果展示区 -->
                    <div id="critique-panel-${escapeHtml(book.id)}-${originalIndex}" class="${step.critique ? '' : 'hidden'}">
                        ${renderCritiqueSnippet(book.id, originalIndex, step.critique)}
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
    syncLegacyOverlayState('pixiv-modal', true, closePixivModal);
    resetPixivModalScroll();
    requestAnimationFrame(resetPixivModalScroll);
    initLucide();
}

function closePixivModal() {
    const modal = document.getElementById('pixiv-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    syncLegacyOverlayState('pixiv-modal', false, closePixivModal);
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
        notify('画册信息已复制到剪贴板。', { type: 'success' });
    } catch (err) {
        if (err?.name === 'AbortError') return;
        console.warn('[Gallery] 分享失败:', err.message);
        notifyError('无法调用系统分享或剪贴板，请稍后重试。');
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

// getLocalBackendUrl 已由前置加载的 core.js 统一声明与挂载

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

// --- 多维度画册模板导出系统 (Multi-Dimensional Comic Export) ---
let activeExportPresetId = 'webtoon';

function openExportMangaModal() {
    const book = savedGalleries.find(b => b.id === activeBookId);
    if (!book) {
        notifyError("请先选择一本画册");
        return;
    }

    const modal = document.getElementById('export-manga-modal');
    if (!modal) {
        // 降级兼容：如果模态框未挂载，直接导出默认条漫
        confirmExportMangaDirect(book, 'webtoon');
        return;
    }

    const titleEl = document.getElementById('export-modal-book-title');
    if (titleEl) titleEl.textContent = book.title || '画册导出';

    renderExportPresetOptions();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (typeof syncLegacyOverlayState === 'function') {
        syncLegacyOverlayState('export-manga-modal', true, closeExportMangaModal);
    }
    initLucide(modal);
}

function closeExportMangaModal() {
    const modal = document.getElementById('export-manga-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        if (typeof syncLegacyOverlayState === 'function') {
            syncLegacyOverlayState('export-manga-modal', false, closeExportMangaModal);
        }
    }
}

function renderExportPresetOptions() {
    const container = document.getElementById('export-presets-list');
    if (!container) return;
    container.innerHTML = '';

    const presets = window.COMIC_EXPORT_PRESETS || [];
    presets.forEach(p => {
        const isSelected = p.id === activeExportPresetId;
        const selectedClasses = isSelected
            ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 ring-2 ring-blue-500/20"
            : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900";

        const card = `
            <div onclick="selectExportPreset(${inlineJsString(p.id)})" class="p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 ${selectedClasses}">
                <div class="p-2.5 rounded-xl ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'} shrink-0">
                    <i data-lucide="${p.icon || 'layout'}" class="w-5 h-5"></i>
                </div>
                <div class="flex-grow min-w-0">
                    <div class="flex items-center justify-between gap-2 mb-1">
                        <span class="text-sm font-bold text-slate-800 dark:text-slate-100">${escapeHtml(p.name)}</span>
                        <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300">${escapeHtml(p.badge || '')}</span>
                    </div>
                    <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">${escapeHtml(p.desc)}</p>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', card);
    });
    initLucide(container);
}

function selectExportPreset(presetId) {
    activeExportPresetId = presetId;
    renderExportPresetOptions();
}

async function confirmExportManga() {
    const book = savedGalleries.find(b => b.id === activeBookId);
    if (!book) return;

    const confirmBtn = document.getElementById('btn-confirm-export-manga');
    const originalText = confirmBtn ? confirmBtn.innerHTML : '';
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> 正在打包单文件...`;
        initLucide(confirmBtn);
    }

    try {
        const showPrompts = document.getElementById('export-opt-prompts')?.checked || false;
        const themeColor = document.getElementById('export-opt-color')?.value || '#6366f1';

        const htmlContent = await generateComicHTML(book, activeExportPresetId, {
            showPrompts,
            themeColor
        });

        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const link = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        const safeTitle = (book.title || 'comic').replace(/[\\/:*?"<>|]/g, '_');
        link.download = `${safeTitle}_${activeExportPresetId}_离线画册.html`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);

        closeExportMangaModal();
        notifySuccess("画册导出成功！独立 HTML 已保存至下载目录。");
    } catch (err) {
        notifyError(`导出画册失败：${err.message}`);
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = originalText;
            initLucide(confirmBtn);
        }
    }
}

async function confirmExportMangaDirect(book, presetId, options = {}) {
    try {
        const htmlContent = await generateComicHTML(book, presetId, options);
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const link = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        const safeTitle = (book.title || 'comic').replace(/[\\/:*?"<>|]/g, '_');
        link.download = `${safeTitle}_${presetId}_离线画册.html`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
        notifySuccess("画册导出成功！");
    } catch (err) {
        notifyError(`导出失败：${err.message}`);
    }
}

// 供外部与按钮调用的统一导出入口（兼容旧直接导出契约与新弹窗选择）
function exportMangaHTML(presetId, options = {}) {
    if (typeof presetId === 'string' && presetId) {
        const book = savedGalleries.find(b => b.id === activeBookId);
        if (!book) return;
        return confirmExportMangaDirect(book, presetId, options);
    }
    openExportMangaModal();
}


// Delete book directly from modal
async function deleteCurrentBook() {
    if (!activeBookId) return;
    const book = savedGalleries.find(b => b.id === activeBookId);
    if (!book) return;

    const confirmed = await confirmAction({
        title: '彻底删除这本画册？',
        message: `「${book.title}」会被永久移除，本地数据不可恢复。`,
        confirmText: '彻底删除',
        danger: true
    });
    if (!confirmed) return;

    savedGalleries = savedGalleries.filter(b => b.id !== activeBookId);
    activeBookId = null;
    saveGalleriesToStorage(false, true);
    closePixivModal();
    renderGallery();
    notify(`已彻底删除画册「${book.title}」。`, { type: 'success' });
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

    // 变量名避开全局的 promptText() 对话框函数
    const redrawPrompt = document.getElementById(`redraw-prompt-${bookId}-${stepIdx}`).value.trim();
    if (!redrawPrompt) {
        notifyWarning('提示词不能为空。');
        return;
    }

    const redrawContainer = document.getElementById(`redraw-panel-${bookId}-${stepIdx}`);
    const btn = redrawContainer?.querySelector("button[onclick*='executeSingleRedraw']") || document.getElementById(`btn-redraw-${bookId}-${stepIdx}`);
    const origText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> 绘制中...`;
        initLucide(btn);
        btn.disabled = true;
    }

    try {
        let newImgUrl = "";
        if (!isMockMode) {
            // Submit single prompt queue to ComfyUI
            newImgUrl = await submitToRealComfy(redrawPrompt);
        } else {
            // Mock single step image redraw delay
            await sleep(1500);
            newImgUrl = getMockVisual(redrawPrompt, stepIdx + 8, book.steps[stepIdx]?.name || "");
        }

        // Apply new render states
        book.steps[stepIdx].image = newImgUrl;
        book.steps[stepIdx].prompt = redrawPrompt;
        delete book.steps[stepIdx].critique; // 重绘成功后清除旧画面的审校报告
        
        saveGalleriesToStorage();
        renderGallery();
        
        // Hot refresh modal viewer
        openPixivModal(bookId);
    } catch (err) {
        notifyError(`重新绘制失败：${err.message}`);
    } finally {
        if (btn) {
            btn.innerHTML = origText;
            btn.disabled = false;
            initLucide(btn);
        }
    }
}

// Toggle sidebar narratives accordion panels with high-fidelity smooth scroll focus
function toggleSidebarAccordion(bookId, idx) {
    const pane = document.getElementById(`accordion-pane-${bookId}-${idx}`);
    const arrow = document.getElementById(`accordion-arrow-${bookId}-${idx}`);
    if (!pane) return;

    const isHidden = pane.classList.contains('hidden');
    
    // Close other panes first to keep sidebar compact
    const escapedBookId = (window.CSS && CSS.escape) ? CSS.escape(bookId) : String(bookId).replace(/([ #;&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
    const allPanes = document.querySelectorAll(`[id^="accordion-pane-${escapedBookId}-"]`);
    const allArrows = document.querySelectorAll(`[id^="accordion-arrow-${escapedBookId}-"]`);
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

// --- AI 视觉审校与画廊折叠卡片绑定辅助逻辑 ---
function renderCritiqueSnippet(bookId, originalIndex, critique) {
    if (!critique) return '';
    const score = (typeof critique.score === 'number' && !isNaN(critique.score))
        ? critique.score
        : (!isNaN(Number(critique.score)) && critique.score !== null && critique.score !== '' ? Number(critique.score) : 7);
    const isPassed = (String(critique.passed).toLowerCase() === 'true' || critique.passed === true) && score >= 7;
    const badgeBg = isPassed 
        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
        : 'bg-amber-500/10 text-amber-500 border-amber-500/30';

    return `
        <div class="p-3 bg-purple-50/40 dark:bg-purple-950/20 border border-purple-500/20 rounded-xl space-y-2 text-left mt-2">
            <div class="flex items-center justify-between">
                <span class="text-[11px] font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                    <i data-lucide="shield-check" class="w-3.5 h-3.5"></i> AI 视觉审校诊断
                </span>
                <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${badgeBg}">
                    ${score}/10 · ${isPassed ? '通过' : '建议微调'}
                </span>
            </div>
            <p class="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed bg-white/70 dark:bg-slate-900/60 p-2 rounded-lg border border-slate-200/50 dark:border-slate-800">
                “${escapeHtml(critique.summary || '画面基本符合剧本设定。')}”
            </p>
            <div class="grid grid-cols-2 gap-1.5 text-[10px]">
                <div class="p-1.5 bg-slate-100 dark:bg-slate-900 rounded">
                    <span class="text-slate-400 font-bold block mb-0.5">肢体解剖</span>
                    <span class="text-slate-600 dark:text-slate-300">${escapeHtml(critique.anatomy || '正常')}</span>
                </div>
                <div class="p-1.5 bg-slate-100 dark:bg-slate-900 rounded">
                    <span class="text-slate-400 font-bold block mb-0.5">特征一致性</span>
                    <span class="text-slate-600 dark:text-slate-300">${escapeHtml(critique.consistency || '符合')}</span>
                </div>
            </div>
            ${critique.suggestions && critique.suggestions !== '无' ? `
                <div class="p-2 bg-amber-500/10 rounded-lg text-[10px] text-amber-700 dark:text-amber-300 flex items-start justify-between gap-1.5">
                    <div><strong>优化建议：</strong>${escapeHtml(critique.suggestions)}</div>
                    <button type="button" onclick="applyCritiqueSuggestionToRedraw(${inlineJsString(bookId)}, ${originalIndex})" class="shrink-0 text-blue-500 hover:underline font-bold">
                        填入重绘框
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

async function auditStepFromAccordion(bookId, originalIndex) {
    const book = savedGalleries.find(b => b.id === bookId);
    if (!book || !Array.isArray(book.steps) || !book.steps[originalIndex]) return;

    const btn = document.getElementById(`btn-audit-${bookId}-${originalIndex}`);
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader" class="w-3 h-3 animate-spin"></i> 审校中...`;
        initLucide(btn);
    }

    const panel = document.getElementById(`critique-panel-${bookId}-${originalIndex}`);
    if (panel) {
        panel.classList.remove('hidden');
        panel.innerHTML = `
            <div class="p-3 bg-purple-50/50 dark:bg-purple-950/30 rounded-xl border border-purple-500/20 text-center text-purple-600 dark:text-purple-400 mt-2">
                <i data-lucide="loader" class="w-4 h-4 animate-spin mx-auto mb-1"></i>
                <span class="text-xs">多模态 Agent 正在分析分镜画面...</span>
            </div>
        `;
        initLucide(panel);
    }

    try {
        notifyInfo("正在调用多模态视觉 Agent 审查分镜画面...", 2500);
        const critique = await VisualCritic.auditPanel(book, originalIndex);
        if (critique === null) {
            // 已被重绘取消或任务取消，不渲染旧报告
            if (panel) panel.classList.add('hidden');
            return;
        }
        if (panel) {
            panel.innerHTML = renderCritiqueSnippet(bookId, originalIndex, critique);
            initLucide(panel);
        }
        const displayScore = (typeof critique.score === 'number') ? critique.score : 8;
        notifySuccess(`分镜 ${originalIndex + 1} 审校完成！综合评分：${displayScore}/10`);
    } catch (err) {
        if (panel) {
            panel.innerHTML = `
                <div class="p-2.5 bg-red-50 dark:bg-red-950/40 rounded-xl border border-red-500/20 text-red-500 text-xs mt-2">
                    审校失败：${escapeHtml(err.message)}
                </div>
            `;
        }
        notifyError(`审校失败：${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
            initLucide(btn);
        }
    }
}

function applyCritiqueSuggestionToRedraw(bookId, originalIndex) {
    const book = savedGalleries.find(b => b.id === bookId);
    if (!book || !book.steps || !book.steps[originalIndex]) return;
    const critique = book.steps[originalIndex].critique;
    if (!critique || !critique.suggestions) return;

    const redrawPane = document.getElementById(`redraw-panel-${bookId}-${originalIndex}`);
    const textarea = document.getElementById(`redraw-prompt-${bookId}-${originalIndex}`);
    if (redrawPane && textarea) {
        redrawPane.classList.remove('hidden');
        const currentPrompt = textarea.value.trim();
        textarea.value = currentPrompt ? `${currentPrompt}, ${critique.suggestions}` : critique.suggestions;
        notifyInfo("已将 AI 建议追加到重绘提示词框中");
    }
}

// 显式挂载基础工具与画廊功能，消除跨文件隐式依赖
window.imageSourceToBase64DataUrl = imageSourceToBase64DataUrl;
window.normalizeImageSourceForExport = normalizeImageSourceForExport;
window.ensureBase64DataUrl = ensureBase64DataUrl;
window.auditStepFromAccordion = auditStepFromAccordion;
window.applyCritiqueSuggestionToRedraw = applyCritiqueSuggestionToRedraw;
window.renderCritiqueSnippet = renderCritiqueSnippet;
window.exportMangaHTML = exportMangaHTML;
window.openExportMangaModal = openExportMangaModal;
window.closeExportMangaModal = closeExportMangaModal;
window.selectExportPreset = selectExportPreset;
window.confirmExportManga = confirmExportManga;

