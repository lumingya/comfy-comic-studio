// js/ui.js - 通用交互层：非阻塞提示、确认/输入对话框、全局快捷键、命令面板。
//
// 这个模块存在的理由是：原先每一次保存模板、导入工作流、测试连接、批量跑完
// 都要弹一次原生 alert()，用户必须伸手点掉才能继续；删除操作则用原生 confirm()，
// 样式割裂且无法区分“危险操作”。全应用一共 30 多处这类阻塞弹窗，是日常使用中
// 最直接的摩擦来源。

// ---------------------------------------------------------------------------
// 浮层栈：Esc 永远只关闭最上面那一层，不会一次性把所有弹窗都关掉
// ---------------------------------------------------------------------------
const overlayStack = [];

function pushOverlay(name, closeFn) {
    overlayStack.push({ name, closeFn });
}

function removeOverlay(name) {
    for (let i = overlayStack.length - 1; i >= 0; i--) {
        if (overlayStack[i].name === name) {
            overlayStack.splice(i, 1);
            return true;
        }
    }
    return false;
}

function closeTopOverlay() {
    const top = overlayStack.pop();
    if (!top) return false;
    try {
        top.closeFn();
    } catch (err) {
        console.warn('[UI] 关闭浮层失败:', err.message);
    }
    return true;
}

// ---------------------------------------------------------------------------
// Toast 通知
// ---------------------------------------------------------------------------
const TOAST_STYLES = {
    success: { icon: 'check-circle-2', accent: 'text-emerald-500', ring: 'border-emerald-500/30' },
    error: { icon: 'alert-octagon', accent: 'text-red-500', ring: 'border-red-500/30' },
    warning: { icon: 'alert-triangle', accent: 'text-amber-500', ring: 'border-amber-500/30' },
    info: { icon: 'info', accent: 'text-blue-500', ring: 'border-blue-500/30' }
};
const TOAST_MAX_VISIBLE = 4;

function getToastContainer() {
    let container = document.getElementById('ccs-toast-container');
    if (container) return container;
    container = document.createElement('div');
    container.id = 'ccs-toast-container';
    container.className = 'ccs-toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
    return container;
}

function dismissToast(toast) {
    if (!toast || toast.dataset.dismissing === 'true') return;
    toast.dataset.dismissing = 'true';
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 180);
}

/**
 * 非阻塞提示。替代原来的 alert()。
 * @param {string} message 正文
 * @param {{type?: 'success'|'error'|'warning'|'info', title?: string, duration?: number}} options
 */
function notify(message, options = {}) {
    const type = TOAST_STYLES[options.type] ? options.type : 'info';
    const style = TOAST_STYLES[type];
    // 错误默认停留更久：用户往往需要读完再决定怎么办。
    const duration = Number.isFinite(options.duration)
        ? options.duration
        : (type === 'error' ? 8000 : 3600);

    const container = getToastContainer();
    while (container.children.length >= TOAST_MAX_VISIBLE) {
        dismissToast(container.firstElementChild);
        if (container.children.length >= TOAST_MAX_VISIBLE) container.firstElementChild?.remove();
    }

    const toast = document.createElement('div');
    toast.className = `ccs-toast ${style.ring}`;
    toast.innerHTML = `
        <i data-lucide="${style.icon}" class="w-4 h-4 shrink-0 mt-0.5 ${style.accent}"></i>
        <div class="min-w-0 flex-grow">
            ${options.title ? `<div class="ccs-toast-title">${escapeHtml(options.title)}</div>` : ''}
            <div class="ccs-toast-body">${escapeHtml(message)}</div>
        </div>
        <button type="button" class="ccs-toast-close" aria-label="关闭提示">
            <i data-lucide="x" class="w-3.5 h-3.5"></i>
        </button>
    `;
    toast.querySelector('.ccs-toast-close').addEventListener('click', () => dismissToast(toast));
    container.appendChild(toast);
    initLucide(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));

    if (duration > 0) setTimeout(() => dismissToast(toast), duration);
    return toast;
}

const notifySuccess = (message, options = {}) => notify(message, { ...options, type: 'success' });
const notifyError = (message, options = {}) => notify(message, { ...options, type: 'error' });
const notifyWarning = (message, options = {}) => notify(message, { ...options, type: 'warning' });

// ---------------------------------------------------------------------------
// 确认 / 输入对话框（Promise 化，替代原生 confirm() 与 prompt()）
// ---------------------------------------------------------------------------
let activeDialogResolver = null;

function closeDialog(result) {
    const host = document.getElementById('ccs-dialog-host');
    if (host) host.remove();
    removeOverlay('dialog');
    const resolve = activeDialogResolver;
    activeDialogResolver = null;
    if (resolve) resolve(result);
}

function buildDialog({ title, message, confirmText, cancelText, danger, input }) {
    const host = document.createElement('div');
    host.id = 'ccs-dialog-host';
    host.className = 'ccs-dialog-backdrop';
    host.innerHTML = `
        <div class="ccs-dialog" role="dialog" aria-modal="true" aria-labelledby="ccs-dialog-title">
            <div class="flex items-start gap-3">
                <div class="ccs-dialog-icon ${danger ? 'is-danger' : ''}">
                    <i data-lucide="${danger ? 'alert-triangle' : (input ? 'pencil-line' : 'help-circle')}" class="w-5 h-5"></i>
                </div>
                <div class="min-w-0 flex-grow space-y-1">
                    <h3 id="ccs-dialog-title" class="ccs-dialog-title">${escapeHtml(title)}</h3>
                    ${message ? `<p class="ccs-dialog-message">${escapeHtml(message)}</p>` : ''}
                </div>
            </div>
            ${input ? `
                <div class="space-y-1.5 pt-1">
                    ${input.label ? `<label for="ccs-dialog-input" class="ccs-dialog-label">${escapeHtml(input.label)}</label>` : ''}
                    <input id="ccs-dialog-input" type="text" class="ccs-dialog-input"
                           value="${escapeHtml(input.value || '')}"
                           placeholder="${escapeHtml(input.placeholder || '')}"
                           autocomplete="off" spellcheck="false">
                    <p id="ccs-dialog-input-error" class="ccs-dialog-error hidden"></p>
                </div>
            ` : ''}
            <div class="flex justify-end gap-2 pt-1">
                <button type="button" class="ccs-dialog-btn ccs-dialog-cancel">${escapeHtml(cancelText || '取消')}</button>
                <button type="button" class="ccs-dialog-btn ccs-dialog-confirm ${danger ? 'is-danger' : ''}">${escapeHtml(confirmText || '确定')}</button>
            </div>
        </div>
    `;
    document.body.appendChild(host);
    initLucide(host);
    return host;
}

/**
 * 危险/不可逆操作的确认框。返回 Promise<boolean>。
 */
function confirmAction({ title, message = '', confirmText = '确定', cancelText = '取消', danger = false } = {}) {
    // 同一时刻只允许一个对话框，避免连点按钮时叠出多层。
    if (activeDialogResolver) closeDialog(false);

    return new Promise((resolve) => {
        activeDialogResolver = resolve;
        const host = buildDialog({ title, message, confirmText, cancelText, danger, input: null });
        pushOverlay('dialog', () => closeDialog(false));

        host.querySelector('.ccs-dialog-cancel').addEventListener('click', () => closeDialog(false));
        host.querySelector('.ccs-dialog-confirm').addEventListener('click', () => closeDialog(true));
        host.addEventListener('mousedown', (event) => {
            if (event.target === host) closeDialog(false);
        });
        host.querySelector('.ccs-dialog-confirm').focus();
    });
}

/**
 * 文本输入对话框。返回 Promise<string|null>（取消时为 null）。
 * validate 返回字符串表示错误信息，返回空表示通过。
 */
function promptText({ title, message = '', label = '', value = '', placeholder = '', confirmText = '确定', validate = null } = {}) {
    if (activeDialogResolver) closeDialog(null);

    return new Promise((resolve) => {
        activeDialogResolver = resolve;
        const host = buildDialog({
            title, message, confirmText, cancelText: '取消', danger: false,
            input: { label, value, placeholder }
        });
        pushOverlay('dialog', () => closeDialog(null));

        const inputEl = host.querySelector('#ccs-dialog-input');
        const errorEl = host.querySelector('#ccs-dialog-input-error');

        const submit = () => {
            const nextValue = inputEl.value.trim();
            const error = validate ? validate(nextValue) : '';
            if (error) {
                errorEl.textContent = error;
                errorEl.classList.remove('hidden');
                inputEl.focus();
                inputEl.select();
                return;
            }
            closeDialog(nextValue);
        };

        host.querySelector('.ccs-dialog-cancel').addEventListener('click', () => closeDialog(null));
        host.querySelector('.ccs-dialog-confirm').addEventListener('click', submit);
        host.addEventListener('mousedown', (event) => {
            if (event.target === host) closeDialog(null);
        });
        inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submit();
            }
        });
        inputEl.focus();
        inputEl.select();
    });
}

// ---------------------------------------------------------------------------
// 命令面板（Ctrl/⌘ + K）
// ---------------------------------------------------------------------------
let paletteItems = [];
let paletteCursor = 0;

const TAB_LABELS = {
    gallery: '画廊展厅',
    templates: '连环画模板配置',
    variables: '批量角色矩阵',
    workflow: 'ComfyUI 工作流',
    llm: 'LLM 剧情与模板'
};

// 命令面板的条目在每次打开时重新收集，这样模板/画册/角色的增删都会即时反映。
function collectPaletteItems() {
    const items = [];

    Object.entries(TAB_LABELS).forEach(([tabId, label]) => {
        items.push({
            group: '前往',
            icon: 'compass',
            title: label,
            hint: '切换标签页',
            run: () => switchTab(tabId)
        });
    });

    (Array.isArray(templates) ? templates : []).forEach(tpl => {
        items.push({
            group: '模板',
            icon: 'layout',
            title: tpl.title || '未命名模板',
            hint: `${tpl.steps?.length || 0} 幕 · 打开并设为当前模板`,
            run: () => {
                switchTab('templates');
                selectTemplate(tpl.id);
            }
        });
    });

    (Array.isArray(savedGalleries) ? savedGalleries : []).slice(0, 60).forEach(book => {
        items.push({
            group: '画册',
            icon: 'book-open',
            title: book.title || '未命名画册',
            hint: `${book.templateTitle || '未知模板'} · 打开阅读器`,
            run: () => {
                switchTab('gallery');
                openPixivModal(book.id);
            }
        });
    });

    (batchMatrix?.rows || []).forEach(row => {
        items.push({
            group: '角色',
            icon: 'user',
            title: row.bookTitle || '未命名角色',
            hint: '打开该角色的剧本编辑器',
            run: () => {
                switchTab('variables');
                openScriptModal(row.id);
            }
        });
    });

    [
        { icon: 'plus', title: '新建连环画模板', run: () => { switchTab('templates'); createNewTemplate(); } },
        { icon: 'user-plus', title: '新增一行角色', run: () => { switchTab('variables'); addMatrixRow(); } },
        { icon: 'play', title: '启动批量出图', run: () => { switchTab('variables'); startBatchGeneration(); } },
        { icon: 'sparkles', title: '打开 AI 聊天精修', run: () => { switchTab('templates'); openChatRefinementModal(); } },
        { icon: 'radio', title: '测试 ComfyUI 连接', run: () => testComfyConnection(false) },
        { icon: 'cpu', title: '测试 LLM 连接', run: () => testLlmConnection() },
        { icon: 'sun-moon', title: '切换深色 / 浅色主题', run: () => toggleTheme() },
        { icon: 'download', title: '导出全部配置备份', run: () => exportConfigBackup() },
        { icon: 'upload', title: '从备份文件恢复配置', run: () => importConfigBackup() }
    ].forEach(action => items.push({ group: '操作', hint: '执行', ...action }));

    return items;
}

function scorePaletteItem(item, query) {
    if (!query) return 1;
    const haystack = `${item.title} ${item.group} ${item.hint || ''}`.toLowerCase();
    if (haystack.includes(query)) return 100 - haystack.indexOf(query);
    // 子序列匹配：允许 "pxv" 命中 "Pixiv"
    let cursor = 0;
    for (const char of query) {
        cursor = haystack.indexOf(char, cursor);
        if (cursor === -1) return 0;
        cursor++;
    }
    return 1;
}

function renderPaletteResults() {
    const listEl = document.getElementById('ccs-palette-list');
    const inputEl = document.getElementById('ccs-palette-input');
    if (!listEl || !inputEl) return;

    const query = inputEl.value.trim().toLowerCase();
    const matches = paletteItems
        .map(item => ({ item, score: scorePaletteItem(item, query) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40)
        .map(entry => entry.item);

    paletteItems.forEach(item => { item._visible = false; });
    matches.forEach(item => { item._visible = true; });
    listEl.dataset.matchCount = String(matches.length);
    paletteCursor = Math.min(paletteCursor, Math.max(0, matches.length - 1));

    if (matches.length === 0) {
        listEl.innerHTML = '<div class="ccs-palette-empty">没有匹配的模板、画册或操作。</div>';
        return;
    }

    listEl.innerHTML = matches.map((item, idx) => `
        <button type="button" class="ccs-palette-item ${idx === paletteCursor ? 'is-active' : ''}" data-palette-index="${idx}">
            <i data-lucide="${escapeHtml(item.icon || 'chevron-right')}" class="w-4 h-4 shrink-0 text-slate-400"></i>
            <span class="ccs-palette-group">${escapeHtml(item.group)}</span>
            <span class="ccs-palette-title">${escapeHtml(item.title)}</span>
            <span class="ccs-palette-hint">${escapeHtml(item.hint || '')}</span>
        </button>
    `).join('');

    listEl.querySelectorAll('[data-palette-index]').forEach(btn => {
        btn.addEventListener('click', () => runPaletteItem(matches[Number(btn.dataset.paletteIndex)]));
        btn.addEventListener('mousemove', () => {
            paletteCursor = Number(btn.dataset.paletteIndex);
            listEl.querySelectorAll('.ccs-palette-item').forEach((el, i) => el.classList.toggle('is-active', i === paletteCursor));
        });
    });
    initLucide(listEl);
    listEl.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    listEl._matches = matches;
}

function runPaletteItem(item) {
    if (!item) return;
    closeCommandPalette();
    try {
        item.run();
    } catch (err) {
        console.error('[Palette] 执行命令失败:', err);
        notifyError(`执行「${item.title}」失败：${err.message}`);
    }
}

function openCommandPalette() {
    if (document.getElementById('ccs-palette-host')) return;

    paletteItems = collectPaletteItems();
    paletteCursor = 0;

    const host = document.createElement('div');
    host.id = 'ccs-palette-host';
    host.className = 'ccs-palette-backdrop';
    host.innerHTML = `
        <div class="ccs-palette" role="dialog" aria-modal="true" aria-label="命令面板">
            <div class="ccs-palette-search">
                <i data-lucide="search" class="w-4 h-4 text-slate-400 shrink-0"></i>
                <input id="ccs-palette-input" type="text" autocomplete="off" spellcheck="false"
                       placeholder="搜索模板、画册、角色，或输入一个操作…">
                <kbd class="ccs-kbd">Esc</kbd>
            </div>
            <div id="ccs-palette-list" class="ccs-palette-list"></div>
            <div class="ccs-palette-footer">
                <span><kbd class="ccs-kbd">↑</kbd><kbd class="ccs-kbd">↓</kbd> 选择</span>
                <span><kbd class="ccs-kbd">Enter</kbd> 执行</span>
                <span><kbd class="ccs-kbd">Ctrl</kbd>+<kbd class="ccs-kbd">K</kbd> 随时唤起</span>
            </div>
        </div>
    `;
    document.body.appendChild(host);
    initLucide(host);
    pushOverlay('palette', closeCommandPalette);

    const inputEl = host.querySelector('#ccs-palette-input');
    const listEl = host.querySelector('#ccs-palette-list');

    inputEl.addEventListener('input', () => {
        paletteCursor = 0;
        renderPaletteResults();
    });
    inputEl.addEventListener('keydown', (event) => {
        const matches = listEl._matches || [];
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            paletteCursor = matches.length ? (paletteCursor + 1) % matches.length : 0;
            renderPaletteResults();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            paletteCursor = matches.length ? (paletteCursor - 1 + matches.length) % matches.length : 0;
            renderPaletteResults();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            runPaletteItem(matches[paletteCursor]);
        }
    });
    host.addEventListener('mousedown', (event) => {
        if (event.target === host) closeCommandPalette();
    });

    renderPaletteResults();
    inputEl.focus();
}

function closeCommandPalette() {
    document.getElementById('ccs-palette-host')?.remove();
    removeOverlay('palette');
}

// ---------------------------------------------------------------------------
// 全局快捷键
// ---------------------------------------------------------------------------
function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function initGlobalShortcuts() {
    if (document.body.dataset.shortcutsBound === 'true') return;
    document.body.dataset.shortcutsBound = 'true';

    document.addEventListener('keydown', (event) => {
        const meta = event.ctrlKey || event.metaKey;

        // Ctrl/⌘ + K：命令面板。即使焦点在输入框里也生效。
        if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            if (document.getElementById('ccs-palette-host')) closeCommandPalette();
            else openCommandPalette();
            return;
        }

        // Ctrl/⌘ + S：保存当前模板，覆盖浏览器的“保存网页”。
        if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
            event.preventDefault();
            if (document.getElementById('tab-templates')?.classList.contains('hidden')) {
                switchTab('templates');
            }
            saveCurrentTemplate();
            return;
        }

        if (event.key === 'Escape') {
            // 只关最上面一层；没有浮层时不做任何事，避免误伤输入。
            if (closeTopOverlay()) event.preventDefault();
            return;
        }

        // Alt + 1..5 直达标签页；在输入框内不拦截，以免打断输入法。
        if (event.altKey && !meta && !isTypingTarget(event.target)) {
            const tabIds = Object.keys(TAB_LABELS);
            const index = Number(event.key) - 1;
            if (Number.isInteger(index) && index >= 0 && index < tabIds.length) {
                event.preventDefault();
                switchTab(tabIds[index]);
            }
        }
    });
}

// 把既有的模态框（画册阅读器、剧本编辑器、聊天浮窗）接入浮层栈，
// 让 Esc 也能按打开顺序逐层关掉它们。
function syncLegacyOverlayState(name, isOpen, closeFn) {
    if (isOpen) {
        if (!overlayStack.some(entry => entry.name === name)) pushOverlay(name, closeFn);
    } else {
        removeOverlay(name);
    }
}

window.notify = notify;
window.confirmAction = confirmAction;
window.promptText = promptText;
window.openCommandPalette = openCommandPalette;
