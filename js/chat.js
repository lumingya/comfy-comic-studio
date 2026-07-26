// js/chat.js - AI 聊天精修：浮窗、会话、附件、Function Calling 工具链。

// ==========================================
// AI 聊天精修 (Chatbox) 功能实现
// ==========================================

let chatSessions = [];
let activeChatSessionId = null;
let pendingChatAttachments = [];
let chatSessionsInitialized = false;
let chatFloatingWindowInitialized = false;
let chatSystemPromptPanelInitialized = false;
let chatInputEnhancementsInitialized = false;
let isChatRequestRunning = false;
let activeChatRequestSessionId = null;
let currentChatThinkingText = "AI 正在思考中...";
let chatRequestAbortController = null;
let chatStopRequested = false;
let chatRefinementOpenTimer = null;
let chatRefinementCloseTimer = null;
const CHAT_FLOATING_WINDOW_LAYOUT_KEY = 'comfy_comic_chat_floating_window_layout';
const CHAT_SYSTEM_PROMPT_STORAGE_KEY = 'comfy_comic_chat_system_prompt';
const CHAT_SYSTEM_PROMPT_PANEL_LAYOUT_KEY = 'comfy_comic_chat_system_prompt_panel_layout';
const CHAT_ATTACHMENT_TEXT_LIMIT = 30000;
const CHAT_ATTACHMENT_MAX_COUNT = 8;
const CHAT_IMAGE_MAX_EDGE = 1600;

function getDefaultChatSystemPromptText() {
    return window.DEFAULT_CHAT_REFINEMENT_SYSTEM_PROMPT || '';
}

function getStoredChatSystemPromptText() {
    const stored = localStorage.getItem(CHAT_SYSTEM_PROMPT_STORAGE_KEY) || '';
    return stored.trim() ? stored : getDefaultChatSystemPromptText();
}

function setChatSystemPromptStatus(text) {
    const statusEl = document.getElementById('chat-system-prompt-status');
    if (statusEl) statusEl.innerText = text;
}

function updateChatSystemPromptCounter() {
    const editor = document.getElementById('chat-system-prompt-editor');
    const counter = document.getElementById('chat-system-prompt-counter');
    if (!editor || !counter) return;
    counter.innerText = `${editor.value.length} 字`;
}

function clampValue(value, min, max) {
    const safeMax = Math.max(min, max);
    return Math.min(Math.max(value, min), safeMax);
}

function toFiniteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function getFloatingViewportSpace(margin = 12) {
    return {
        width: Math.max(1, window.innerWidth - margin * 2),
        height: Math.max(1, window.innerHeight - margin * 2)
    };
}

function getChatWindowMinSize() {
    const space = getFloatingViewportSpace();
    return {
        width: Math.min(window.innerWidth <= 768 ? 320 : 720, space.width),
        height: Math.min(window.innerWidth <= 768 ? 420 : 460, space.height)
    };
}

function getChatPromptPanelMinSize() {
    const space = getFloatingViewportSpace();
    return {
        width: Math.min(window.innerWidth <= 768 ? 300 : 420, space.width),
        height: Math.min(window.innerWidth <= 768 ? 300 : 280, space.height)
    };
}

function constrainFloatingLayout(layout, minSize, defaultTop = 12, margin = 12) {
    const space = getFloatingViewportSpace(margin);
    const maxWidth = Math.max(minSize.width, space.width);
    const maxHeight = Math.max(minSize.height, space.height);
    const width = clampValue(toFiniteNumber(layout?.width, minSize.width), minSize.width, maxWidth);
    const height = clampValue(toFiniteNumber(layout?.height, minSize.height), minSize.height, maxHeight);
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const left = clampValue(toFiniteNumber(layout?.left, margin), margin, maxLeft);
    const top = clampValue(toFiniteNumber(layout?.top, defaultTop), margin, maxTop);
    return { left, top, width, height };
}

function getResizedFloatingLayout(rect, dir, dx, dy, minSize, margin = 12) {
    const bounds = {
        left: margin,
        top: margin,
        right: Math.max(margin, window.innerWidth - margin),
        bottom: Math.max(margin, window.innerHeight - margin)
    };
    let left = rect.left;
    let top = rect.top;
    let right = rect.right;
    let bottom = rect.bottom;

    if (dir.includes('e')) right = clampValue(rect.right + dx, left + minSize.width, bounds.right);
    if (dir.includes('s')) bottom = clampValue(rect.bottom + dy, top + minSize.height, bounds.bottom);
    if (dir.includes('w')) left = clampValue(rect.left + dx, bounds.left, right - minSize.width);
    if (dir.includes('n')) top = clampValue(rect.top + dy, bounds.top, bottom - minSize.height);

    return {
        left,
        top,
        width: right - left,
        height: bottom - top
    };
}

function shouldIgnoreFloatingDrag(event) {
    return event.button !== 0 || !!event.target.closest('button, input, textarea, select, a, [contenteditable="true"], [contenteditable="plaintext-only"]');
}

function capturePointer(target, pointerId) {
    try {
        target.setPointerCapture(pointerId);
    } catch (err) {
        console.warn("浮窗指针捕获失败:", err.message);
    }
}

function releasePointer(target, pointerId) {
    try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } catch (err) {
        console.warn("浮窗指针释放失败:", err.message);
    }
}

function bindFloatingDrag(element, handle, applyLayout, saveLayout) {
    handle.addEventListener('pointerdown', (event) => {
        if (shouldIgnoreFloatingDrag(event)) return;
        event.preventDefault();
        const rect = element.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        element.classList.add('is-moving');
        capturePointer(handle, event.pointerId);

        const moveElement = (moveEvent) => {
            applyLayout({
                left: rect.left + moveEvent.clientX - startX,
                top: rect.top + moveEvent.clientY - startY,
                width: rect.width,
                height: rect.height
            });
        };
        const stopMove = () => {
            element.classList.remove('is-moving');
            handle.removeEventListener('pointermove', moveElement);
            releasePointer(handle, event.pointerId);
            saveLayout();
        };

        handle.addEventListener('pointermove', moveElement);
        handle.addEventListener('pointerup', stopMove, { once: true });
        handle.addEventListener('pointercancel', stopMove, { once: true });
    });
}

function bindFloatingResize(element, resizeHandle, getMinSize, applyLayout, saveLayout) {
    resizeHandle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const dir = resizeHandle.dataset.resizeDir || '';
        const rect = element.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        element.classList.add('is-resizing');
        capturePointer(resizeHandle, event.pointerId);

        const resizeElement = (moveEvent) => {
            applyLayout(getResizedFloatingLayout(
                rect,
                dir,
                moveEvent.clientX - startX,
                moveEvent.clientY - startY,
                getMinSize()
            ));
        };

        const stopResize = () => {
            element.classList.remove('is-resizing');
            resizeHandle.removeEventListener('pointermove', resizeElement);
            releasePointer(resizeHandle, event.pointerId);
            saveLayout();
        };

        resizeHandle.addEventListener('pointermove', resizeElement);
        resizeHandle.addEventListener('pointerup', stopResize, { once: true });
        resizeHandle.addEventListener('pointercancel', stopResize, { once: true });
    });
}

function getDefaultChatWindowLayout() {
    const minSize = getChatWindowMinSize();
    const space = getFloatingViewportSpace();
    const width = Math.min(1120, Math.max(minSize.width, window.innerWidth - 80), space.width);
    const height = Math.min(720, Math.max(minSize.height, window.innerHeight - 80), space.height);
    return {
        left: Math.max(12, Math.round((window.innerWidth - width) / 2)),
        top: Math.max(12, Math.round((window.innerHeight - height) / 2)),
        width,
        height
    };
}

function constrainChatWindowLayout(layout) {
    return constrainFloatingLayout(layout, getChatWindowMinSize(), 12);
}

function applyChatWindowLayout(layout) {
    const chatWindow = document.getElementById('chat-refinement-window');
    if (!chatWindow) return;
    const safeLayout = constrainChatWindowLayout(layout);
    chatWindow.style.left = `${safeLayout.left}px`;
    chatWindow.style.top = `${safeLayout.top}px`;
    chatWindow.style.width = `${safeLayout.width}px`;
    chatWindow.style.height = `${safeLayout.height}px`;
}

function saveChatWindowLayout() {
    const chatWindow = document.getElementById('chat-refinement-window');
    if (!chatWindow) return;
    const rect = chatWindow.getBoundingClientRect();
    localStorage.setItem(CHAT_FLOATING_WINDOW_LAYOUT_KEY, JSON.stringify({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
    }));
    saveChatConfigFromState();
}

function initChatFloatingWindow() {
    const chatWindow = document.getElementById('chat-refinement-window');
    const dragHandle = document.getElementById('chat-refinement-drag-handle');
    if (!chatWindow || !dragHandle) return;

    let initialLayout = getDefaultChatWindowLayout();
    try {
        const storedLayout = JSON.parse(localStorage.getItem(CHAT_FLOATING_WINDOW_LAYOUT_KEY) || 'null');
        if (storedLayout) initialLayout = storedLayout;
    } catch (e) {
        console.warn("解析聊天浮窗布局失败:", e);
    }
    applyChatWindowLayout(initialLayout);

    if (!chatFloatingWindowInitialized) {
        chatWindow.querySelectorAll('.chat-window-drag-handle').forEach((handle) => {
            bindFloatingDrag(chatWindow, handle, applyChatWindowLayout, saveChatWindowLayout);
        });

        chatWindow.querySelectorAll('.chat-window-resize-handle').forEach((resizeHandle) => {
            bindFloatingResize(chatWindow, resizeHandle, getChatWindowMinSize, applyChatWindowLayout, saveChatWindowLayout);
        });

        window.addEventListener('resize', () => {
            const rect = chatWindow.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            applyChatWindowLayout(rect);
            saveChatWindowLayout();
        });

        chatFloatingWindowInitialized = true;
    }
}

function getDefaultChatPromptPanelLayout() {
    const minSize = getChatPromptPanelMinSize();
    const space = getFloatingViewportSpace();
    const width = Math.min(640, Math.max(minSize.width, window.innerWidth - 48), space.width);
    const height = Math.min(440, Math.max(minSize.height, window.innerHeight - 140), space.height);
    return {
        left: Math.max(12, window.innerWidth - width - 80),
        top: Math.max(76, Math.min(96, window.innerHeight - height - 12)),
        width,
        height
    };
}

function constrainChatPromptPanelLayout(layout) {
    return constrainFloatingLayout(layout, getChatPromptPanelMinSize(), 76);
}

function applyChatPromptPanelLayout(layout) {
    const panel = document.getElementById('chat-system-prompt-panel');
    if (!panel) return;
    const safeLayout = constrainChatPromptPanelLayout(layout);
    panel.style.left = `${safeLayout.left}px`;
    panel.style.top = `${safeLayout.top}px`;
    panel.style.width = `${safeLayout.width}px`;
    panel.style.height = `${safeLayout.height}px`;
}

function saveChatPromptPanelLayout() {
    const panel = document.getElementById('chat-system-prompt-panel');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    localStorage.setItem(CHAT_SYSTEM_PROMPT_PANEL_LAYOUT_KEY, JSON.stringify({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
    }));
    saveChatConfigFromState();
}

function initChatSystemPromptPanel() {
    const panel = document.getElementById('chat-system-prompt-panel');
    const dragHandle = document.getElementById('chat-system-prompt-drag-handle');
    if (!panel || !dragHandle) return;

    let initialLayout = getDefaultChatPromptPanelLayout();
    try {
        const storedLayout = JSON.parse(localStorage.getItem(CHAT_SYSTEM_PROMPT_PANEL_LAYOUT_KEY) || 'null');
        if (storedLayout) initialLayout = storedLayout;
    } catch (e) {
        console.warn("解析系统提示词浮窗布局失败:", e);
    }
    applyChatPromptPanelLayout(initialLayout);

    if (!chatSystemPromptPanelInitialized) {
        bindFloatingDrag(panel, dragHandle, applyChatPromptPanelLayout, saveChatPromptPanelLayout);

        panel.querySelectorAll('.chat-system-resize-handle').forEach((resizeHandle) => {
            bindFloatingResize(panel, resizeHandle, getChatPromptPanelMinSize, applyChatPromptPanelLayout, saveChatPromptPanelLayout);
        });

        window.addEventListener('resize', () => {
            const rect = panel.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            applyChatPromptPanelLayout(rect);
            saveChatPromptPanelLayout();
        });

        chatSystemPromptPanelInitialized = true;
    }

    initLucide(panel);
}

function openChatSystemPromptPanel() {
    initChatSystemPromptPanel();
    const panel = document.getElementById('chat-system-prompt-panel');
    const beforeEl = document.getElementById('chat-system-prompt-before');
    const editor = document.getElementById('chat-system-prompt-editor');
    if (!panel || !beforeEl || !editor) return;

    const currentPrompt = getStoredChatSystemPromptText();
    beforeEl.value = currentPrompt;
    editor.value = currentPrompt;
    updateChatSystemPromptCounter();
    setChatSystemPromptStatus("已加载");
    panel.classList.remove('hidden');
    initLucide(panel);
}

function closeChatSystemPromptPanel() {
    const panel = document.getElementById('chat-system-prompt-panel');
    if (panel) panel.classList.add('hidden');
}

function toggleChatSystemPromptPanel() {
    const panel = document.getElementById('chat-system-prompt-panel');
    if (!panel || panel.classList.contains('hidden')) {
        openChatSystemPromptPanel();
    } else {
        closeChatSystemPromptPanel();
    }
}

function handleChatSystemPromptInput() {
    updateChatSystemPromptCounter();
    const editor = document.getElementById('chat-system-prompt-editor');
    if (!editor) return;
    setChatSystemPromptStatus(editor.value.trim() ? "有未保存修改" : "提示词不能为空");
}

function saveChatSystemPromptEditor() {
    const editor = document.getElementById('chat-system-prompt-editor');
    if (!editor) return;
    if (!editor.value.trim()) {
        alert("系统提示词不能为空。");
        return;
    }
    localStorage.setItem(CHAT_SYSTEM_PROMPT_STORAGE_KEY, editor.value);
    setChatSystemPromptStatus("已保存");
    saveChatConfigFromState();
}

function resetChatSystemPromptToDefault() {
    const editor = document.getElementById('chat-system-prompt-editor');
    if (!editor) return;
    editor.value = getDefaultChatSystemPromptText();
    handleChatSystemPromptInput();
}

function syncChatSystemPromptSnapshot() {
    const beforeEl = document.getElementById('chat-system-prompt-before');
    const editor = document.getElementById('chat-system-prompt-editor');
    if (!beforeEl || !editor) return;
    beforeEl.value = editor.value;
    setChatSystemPromptStatus("快照已更新");
}

function initChatInputEnhancements() {
    if (chatInputEnhancementsInitialized) {
        updateChatSendButtonState();
        return;
    }

    const inputEl = document.getElementById('chat-user-input');
    if (inputEl) {
        inputEl.addEventListener('input', (event) => {
            adjustTextareaHeight(event.target);
            updateChatSendButtonState();
        });
        chatInputEnhancementsInitialized = true;
    }
    renderPendingChatAttachments();
    updateChatSendButtonState();
}

function updateChatSendButtonState() {
    const inputEl = document.getElementById('chat-user-input');
    const sendBtn = document.getElementById('chat-send-btn');
    if (!inputEl || !sendBtn) return;
    const mode = isChatRequestRunning ? 'stop' : 'send';
    if (sendBtn.dataset.mode !== mode) {
        sendBtn.dataset.mode = mode;
        sendBtn.innerHTML = isChatRequestRunning
            ? '<i data-lucide="square" class="w-4 h-4 fill-current"></i>'
            : '<i data-lucide="send" class="w-4 h-4"></i>';
        initLucide(sendBtn);
    }
    sendBtn.title = isChatRequestRunning ? "停止 AI 输出" : "发送";
    sendBtn.setAttribute('aria-label', sendBtn.title);
    sendBtn.classList.toggle('chat-send-stop', isChatRequestRunning);
    sendBtn.disabled = isChatRequestRunning ? false : (!inputEl.value.trim() && pendingChatAttachments.length === 0);
}

function stopChatMessage() {
    if (!isChatRequestRunning) return;
    chatStopRequested = true;
    if (chatRequestAbortController) {
        chatRequestAbortController.abort();
    }
    updateChatThinkingBubbleText("已停止 AI 输出");
}

function openChatAttachmentPicker() {
    const input = document.getElementById('chat-attachment-input');
    if (input) input.click();
}

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function truncateChatAttachmentText(text) {
    const cleanText = (text || '').trim();
    if (cleanText.length <= CHAT_ATTACHMENT_TEXT_LIMIT) return cleanText;
    return `${cleanText.slice(0, CHAT_ATTACHMENT_TEXT_LIMIT)}\n\n[内容过长，已截断前 ${CHAT_ATTACHMENT_TEXT_LIMIT} 字]`;
}

function readChatFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
        reader.readAsDataURL(file);
    });
}

function readChatFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
        reader.readAsArrayBuffer(file);
    });
}

async function imageFileToChatDataUrl(file) {
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
        return readChatFileAsDataUrl(file);
    }

    const objectUrl = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("图片读取失败"));
            image.src = objectUrl;
        });
        const scale = Math.min(1, CHAT_IMAGE_MAX_EDGE / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', 0.86);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function decodeXmlEntities(value) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
}

async function decompressZipDeflate(bytes) {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error("当前浏览器不支持 docx 解压读取");
    }

    let lastError = null;
    for (const format of ['deflate-raw', 'deflate']) {
        try {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error("docx 解压失败");
}

async function extractDocxTextFromArrayBuffer(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    let eocdOffset = -1;
    const minOffset = Math.max(0, data.length - 22 - 0xffff);

    for (let offset = data.length - 22; offset >= minOffset; offset--) {
        if (view.getUint32(offset, true) === 0x06054b50) {
            eocdOffset = offset;
            break;
        }
    }
    if (eocdOffset < 0) throw new Error("docx 文件结构不完整");

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    let centralOffset = view.getUint32(eocdOffset + 16, true);
    let targetEntry = null;

    for (let i = 0; i < totalEntries; i++) {
        if (view.getUint32(centralOffset, true) !== 0x02014b50) break;
        const method = view.getUint16(centralOffset + 10, true);
        const compressedSize = view.getUint32(centralOffset + 20, true);
        const fileNameLength = view.getUint16(centralOffset + 28, true);
        const extraLength = view.getUint16(centralOffset + 30, true);
        const commentLength = view.getUint16(centralOffset + 32, true);
        const localHeaderOffset = view.getUint32(centralOffset + 42, true);
        const nameBytes = data.slice(centralOffset + 46, centralOffset + 46 + fileNameLength);
        const fileName = new TextDecoder('utf-8').decode(nameBytes);

        if (fileName === 'word/document.xml') {
            targetEntry = { method, compressedSize, localHeaderOffset };
            break;
        }
        centralOffset += 46 + fileNameLength + extraLength + commentLength;
    }

    if (!targetEntry) throw new Error("docx 中没有找到正文内容");
    if (view.getUint32(targetEntry.localHeaderOffset, true) !== 0x04034b50) {
        throw new Error("docx 正文头信息异常");
    }

    const localNameLength = view.getUint16(targetEntry.localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(targetEntry.localHeaderOffset + 28, true);
    const dataStart = targetEntry.localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedBytes = data.slice(dataStart, dataStart + targetEntry.compressedSize);
    let xmlBytes;

    if (targetEntry.method === 0) {
        xmlBytes = compressedBytes;
    } else if (targetEntry.method === 8) {
        xmlBytes = await decompressZipDeflate(compressedBytes);
    } else {
        throw new Error("暂不支持该 docx 压缩格式");
    }

    const xml = new TextDecoder('utf-8').decode(xmlBytes);
    const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
    const lines = paragraphs.map((paragraph) => {
        const runs = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
        return runs.map((run) => decodeXmlEntities(run[1])).join('');
    }).filter(Boolean);

    if (lines.length > 0) return lines.join('\n');
    const runs = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
    return runs.map((run) => decodeXmlEntities(run[1])).join('\n');
}

async function readChatAttachment(file) {
    const name = file.name || '未命名文件';
    const ext = name.split('.').pop().toLowerCase();
    const id = `chat_att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (file.type.startsWith('image/')) {
        const dataUrl = await imageFileToChatDataUrl(file);
        return {
            id,
            kind: 'image',
            name,
            mime: file.type || 'image/jpeg',
            size: file.size,
            dataUrl
        };
    }

    if (ext === 'txt' || file.type === 'text/plain') {
        const text = typeof file.text === 'function'
            ? await file.text()
            : new TextDecoder('utf-8').decode(await readChatFileAsArrayBuffer(file));
        return {
            id,
            kind: 'text',
            name,
            mime: file.type || 'text/plain',
            size: file.size,
            text: truncateChatAttachmentText(text)
        };
    }

    if (ext === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const text = await extractDocxTextFromArrayBuffer(await readChatFileAsArrayBuffer(file));
        return {
            id,
            kind: 'docx',
            name,
            mime: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: file.size,
            text: truncateChatAttachmentText(text)
        };
    }

    throw new Error("仅支持图片、txt、docx 文件");
}

async function handleChatAttachmentUpload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;

    for (const file of files) {
        if (pendingChatAttachments.length >= CHAT_ATTACHMENT_MAX_COUNT) {
            alert(`最多同时上传 ${CHAT_ATTACHMENT_MAX_COUNT} 个附件。`);
            break;
        }
        try {
            const attachment = await readChatAttachment(file);
            pendingChatAttachments.push(attachment);
        } catch (err) {
            alert(`${file.name} 读取失败：${err.message}`);
        }
    }

    renderPendingChatAttachments();
}

function removePendingChatAttachment(id) {
    pendingChatAttachments = pendingChatAttachments.filter(att => att.id !== id);
    renderPendingChatAttachments();
}

function renderPendingChatAttachments() {
    const preview = document.getElementById('chat-attachments-preview');
    if (!preview) return;
    preview.innerHTML = '';
    preview.classList.toggle('hidden', pendingChatAttachments.length === 0);

    pendingChatAttachments.forEach((att) => {
        const chip = document.createElement('div');
        chip.className = 'chat-attachment-chip flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 text-xs min-w-0';

        const leading = att.kind === 'image' && att.dataUrl
            ? `<img src="${att.dataUrl}" alt="" class="chat-attachment-thumb rounded-md border border-slate-200 dark:border-slate-800 shrink-0">`
            : `<div class="w-7 h-7 rounded-md bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0"><i data-lucide="file-text" class="w-3.5 h-3.5"></i></div>`;

        chip.innerHTML = `
            ${leading}
            <div class="min-w-0 flex-grow">
                <div class="truncate font-semibold" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</div>
                <div class="text-[10px] text-slate-400 dark:text-slate-500">${att.kind.toUpperCase()} · ${formatFileSize(att.size)}</div>
            </div>
            <button onclick="removePendingChatAttachment('${att.id}')" class="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-red-500 shrink-0" title="移除">
                <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>
        `;
        preview.appendChild(chip);
    });

    updateChatSendButtonState();
    initLucide(preview);
}

function renderMessageAttachments(bubble, attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'mt-3 flex flex-wrap gap-2';
    attachments.forEach((att) => {
        if (att.kind === 'image' && att.dataUrl) {
            const img = document.createElement('img');
            img.src = att.dataUrl;
            img.alt = att.name || '上传图片';
            img.className = 'chat-message-attachment-image rounded-lg border border-white/20 bg-slate-950/20';
            wrapper.appendChild(img);
            return;
        }

        const chip = document.createElement('div');
        chip.className = 'max-w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border border-white/20 bg-white/10 text-[11px]';
        chip.innerHTML = `
            <i data-lucide="file-text" class="w-3.5 h-3.5 shrink-0"></i>
            <span class="truncate">${escapeHtml(att.name || '附件')}</span>
        `;
        wrapper.appendChild(chip);
    });
    bubble.appendChild(wrapper);
}

function renderChatMessageMarkdown(text) {
    return escapeHtml(text || '')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code class="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-blue-500 font-mono font-semibold">$1</code>');
}

function renderChatMessageContent(contentEl, text) {
    contentEl.innerHTML = renderChatMessageMarkdown(text);
}

function readEditableChatText(contentEl) {
    return (contentEl.innerText || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\n$/, '');
}

function focusEditableTextEnd(contentEl) {
    const range = document.createRange();
    range.selectNodeContents(contentEl);
    range.collapse(false);
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
}

function createChatMessageActionButton(icon, title, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chat-message-action-btn ${extraClass}`;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = `<i data-lucide="${icon}" class="w-3.5 h-3.5"></i>`;
    return button;
}

function isBlankAssistantTextMessage(msg) {
    return msg?.role === 'assistant'
        && !msg.tool_calls
        && !(msg.content || '').trim()
        && (!Array.isArray(msg.attachments) || msg.attachments.length === 0);
}

function pruneBlankAssistantMessages() {
    chatSessions.forEach((session) => {
        if (Array.isArray(session.messages)) {
            session.messages = session.messages.filter(msg => !isBlankAssistantTextMessage(msg));
        }
    });
}

function attachChatMessageEditor(bubble, contentEl, msg, canDelete, editLabel) {
    if (msg.tool_calls) return;

    const actions = document.createElement('div');
    actions.className = 'chat-message-actions';

    const editBtn = createChatMessageActionButton('edit-3', `编辑${editLabel}`, 'chat-edit-button');
    const saveBtn = createChatMessageActionButton('check', '保存修改', 'chat-edit-save-btn');
    const cancelBtn = createChatMessageActionButton('x', '取消编辑', 'chat-edit-cancel-btn');
    actions.append(editBtn, saveBtn, cancelBtn);
    bubble.appendChild(actions);

    let originalContent = msg.content || '';

    const startEdit = () => {
        originalContent = msg.content || '';
        bubble.classList.add('is-editing');
        bubble.removeAttribute('title');
        contentEl.innerText = originalContent;
        contentEl.setAttribute('contenteditable', 'plaintext-only');
        contentEl.setAttribute('role', 'textbox');
        contentEl.setAttribute('aria-label', `编辑${editLabel}`);
        contentEl.spellcheck = true;
        contentEl.focus();
        focusEditableTextEnd(contentEl);
    };

    const finishEdit = (shouldSave) => {
        if (!bubble.classList.contains('is-editing')) return;

        if (shouldSave) {
            const nextContent = readEditableChatText(contentEl);
            const hasAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0;
            if (!nextContent.trim() && !hasAttachments) {
                alert("消息内容不能为空。如果不需要这条消息，可以双击删除。");
                contentEl.focus();
                focusEditableTextEnd(contentEl);
                return;
            }
            msg.content = nextContent;
            saveChatSessions();
        } else {
            msg.content = originalContent;
        }

        contentEl.removeAttribute('contenteditable');
        contentEl.removeAttribute('role');
        contentEl.removeAttribute('aria-label');
        contentEl.spellcheck = false;
        renderChatMessageContent(contentEl, msg.content || '');
        bubble.classList.remove('is-editing');
        if (canDelete) bubble.title = "双击删除此消息";
    };

    [editBtn, saveBtn, cancelBtn].forEach((button) => {
        button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        button.addEventListener('click', (event) => event.stopPropagation());
        button.addEventListener('dblclick', (event) => event.stopPropagation());
    });

    editBtn.onclick = () => startEdit();
    saveBtn.onclick = () => finishEdit(true);
    cancelBtn.onclick = () => finishEdit(false);

    contentEl.addEventListener('keydown', (event) => {
        if (!bubble.classList.contains('is-editing')) return;
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            finishEdit(true);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            finishEdit(false);
        }
    });

    contentEl.addEventListener('paste', (event) => {
        if (!bubble.classList.contains('is-editing')) return;
        event.preventDefault();
        const text = event.clipboardData?.getData('text/plain') || '';
        document.execCommand('insertText', false, text);
    });

    contentEl.addEventListener('blur', () => {
        if (!bubble.classList.contains('is-editing')) return;
        setTimeout(() => {
            if (!actions.contains(document.activeElement)) {
                finishEdit(true);
            }
        }, 0);
    });
}

function initChatSessions() {
    if (chatSessionsInitialized && Array.isArray(chatSessions) && chatSessions.length > 0) {
        pruneBlankAssistantMessages();
        if (!activeChatSessionId || !chatSessions.some(session => session.id === activeChatSessionId)) {
            activeChatSessionId = chatSessions[0].id;
        }
        return;
    }

    try {
        const stored = localStorage.getItem('comfy_comic_chat_sessions');
        if (stored) {
            chatSessions = JSON.parse(stored);
        }
    } catch (e) {
        console.warn("解析聊天会话失败:", e);
    }

    if (!chatSessions || chatSessions.length === 0) {
        chatSessions = [
            {
                id: "session_default_" + Date.now(),
                title: "新精修对话 1",
                messages: [
                    {
                        role: "assistant",
                        content: "你好！我是你的 AI 聊天精修助手。你可以用自然语言命令我修改当前的连环画模板。\n\n你可以对我说，例如：\n* “帮我把主线思路改写得更加跌宕起伏一点”\n* “把第二幕的画面提示词改写成雪山夜景，并加上极光特效”\n* “在第三幕和第四幕之间插入一个新分镜，名字叫‘夜色降临’”\n* “把第三幕 and 第四幕交换一下顺序”\n\n请问现在需要我为你做些什么修改？"
                    }
                ]
            }
        ];
    }
    pruneBlankAssistantMessages();
    const storedActiveId = localStorage.getItem('comfy_comic_active_chat_session_id');
    activeChatSessionId = chatSessions.some(session => session.id === storedActiveId)
        ? storedActiveId
        : chatSessions[0].id;
    chatSessionsInitialized = true;
    saveChatSessions();
}

function saveChatSessions() {
    localStorage.setItem('comfy_comic_chat_sessions', JSON.stringify(chatSessions));
    if (activeChatSessionId) {
        localStorage.setItem('comfy_comic_active_chat_session_id', activeChatSessionId);
    }
    saveChatConfigFromState();
}

function openChatRefinementModal() {
    // 先检查当前是否有激活的模板
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) {
        alert("请先选择或创建一个漫画模板，才能启动 AI 聊天精修！");
        return;
    }

    const modal = document.getElementById('chat-refinement-modal');
    if (!modal) return;

    initChatFloatingWindow();
    if (chatRefinementCloseTimer) {
        clearTimeout(chatRefinementCloseTimer);
        chatRefinementCloseTimer = null;
    }
    modal.classList.remove('hidden');
    const transformTarget = modal.querySelector('.transform');
    if (chatRefinementOpenTimer) clearTimeout(chatRefinementOpenTimer);
    chatRefinementOpenTimer = setTimeout(() => {
        transformTarget?.classList.remove('scale-95');
        chatRefinementOpenTimer = null;
    }, 50);

    initChatSessions();
    initChatInputEnhancements();
    renderChatSessionsList();
    renderChatMessages();
    if (isChatRequestRunning && activeChatRequestSessionId === activeChatSessionId) {
        appendChatThinkingBubble();
    }
    initLucide();
}

function closeChatRefinementModal() {
    const modal = document.getElementById('chat-refinement-modal');
    if (!modal) return;
    if (chatRefinementOpenTimer) {
        clearTimeout(chatRefinementOpenTimer);
        chatRefinementOpenTimer = null;
    }
    modal.querySelector('.transform')?.classList.add('scale-95');
    closeChatSystemPromptPanel();
    if (chatRefinementCloseTimer) clearTimeout(chatRefinementCloseTimer);
    chatRefinementCloseTimer = setTimeout(() => {
        modal.classList.add('hidden');
        chatRefinementCloseTimer = null;
    }, 150);
}

function createNewChatSession() {
    const newId = "session_" + Date.now();
    const newSession = {
        id: newId,
        title: `新精修对话 ${chatSessions.length + 1}`,
        messages: [
            {
                role: "assistant",
                content: "已开启新的精修会话！请发送你的指令，我会自动调度工具来帮您微调当前的模板。"
            }
        ]
    };
    chatSessions.unshift(newSession);
    activeChatSessionId = newId;
    saveChatSessions();
    renderChatSessionsList();
    renderChatMessages();
}

function switchChatSession(id) {
    activeChatSessionId = id;
    saveChatConfigFromState();
    renderChatSessionsList();
    renderChatMessages();
}

function deleteChatSession(id, event) {
    if (event) event.stopPropagation();
    if (chatSessions.length <= 1) {
        alert("至少需要保留一个对话历史！");
        return;
    }
    
    if (!confirm("确定要删除这个对话历史吗？")) return;

    chatSessions = chatSessions.filter(s => s.id !== id);
    if (activeChatSessionId === id) {
        activeChatSessionId = chatSessions[0].id;
    }
    saveChatSessions();
    renderChatSessionsList();
    renderChatMessages();
}

function renameChatSession(id, newTitle) {
    const session = chatSessions.find(s => s.id === id);
    if (session && newTitle.trim()) {
        session.title = newTitle.trim();
        saveChatSessions();
        renderChatSessionsList();
    }
}

function clearCurrentSessionMessages() {
    let session = chatSessions.find(s => s.id === activeChatSessionId);
    if (!session) return;
    if (!confirm("确定要清空当前会话的所有聊天消息吗？")) return;

    session.messages = [
        {
            role: "assistant",
            content: "会话已清空！有什么需要我为您修改的吗？"
        }
    ];
    saveChatSessions();
    renderChatMessages();
}

function renderChatSessionsList() {
    const listEl = document.getElementById('chat-sessions-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    chatSessions.forEach(session => {
        const isActive = session.id === activeChatSessionId;
        const activeClass = isActive 
            ? 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400 font-semibold' 
            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60';
        
        const item = document.createElement('div');
        item.className = `chat-session-item group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer text-xs transition ${activeClass}`;
        item.onclick = () => switchChatSession(session.id);

        item.innerHTML = `
            <div class="flex items-center gap-2 overflow-hidden flex-grow mr-2">
                <i data-lucide="message-square" class="w-3.5 h-3.5 shrink-0"></i>
                <span class="truncate session-title-text" title="双击重命名">${escapeHtml(session.title)}</span>
                <input type="text" class="hidden session-title-input bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-1 py-0.5 text-xs w-full focus:outline-none" value="${escapeHtml(session.title)}">
            </div>
            <button class="delete-session-btn p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-red-500 transition shrink-0" title="删除对话">
                <i data-lucide="trash" class="w-3 h-3"></i>
            </button>
        `;

        // 动态安全绑定删除会话按钮事件，阻断 DOM XSS
        item.querySelector('.delete-session-btn').onclick = (e) => deleteChatSession(session.id, e);

        // 实现双击重命名
        const titleSpan = item.querySelector('.session-title-text');
        const titleInput = item.querySelector('.session-title-input');
        
        titleSpan.ondblclick = (e) => {
            e.stopPropagation();
            titleSpan.classList.add('hidden');
            titleInput.classList.remove('hidden');
            titleInput.focus();
            titleInput.select();
        };

        const finishRename = () => {
            titleSpan.classList.remove('hidden');
            titleInput.classList.add('hidden');
            if (titleInput.value.trim() && titleInput.value.trim() !== session.title) {
                renameChatSession(session.id, titleInput.value);
            }
        };

        titleInput.onblur = finishRename;
        titleInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                finishRename();
            } else if (e.key === 'Escape') {
                titleInput.value = session.title;
                titleSpan.classList.remove('hidden');
                titleInput.classList.add('hidden');
            }
        };

        listEl.appendChild(item);
    });
    
    initLucide();
}

function renderChatMessages() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;

    container.innerHTML = '';
    const session = chatSessions.find(s => s.id === activeChatSessionId);
    if (!session) return;

    // 过滤并展示
    session.messages.forEach((msg, idx) => {
        if (msg.role === 'system') return;
        if (isBlankAssistantTextMessage(msg)) return;

        // 如果是工具执行的反馈
        if (msg.role === 'tool') {
            let resObj = {};
            try { resObj = JSON.parse(msg.content); } catch (e) {}
            const text = resObj.success 
                ? `⚙️ 成功执行 [${msg.name}]: ${resObj.message || '操作成功'}`
                : `❌ 执行 [${msg.name}] 失败: ${resObj.error || '未知错误'}`;
            
            const toolEl = document.createElement('div');
            toolEl.className = 'chat-bubble-tool px-3 py-1.5 max-w-[85%] mx-auto select-none my-1';
            toolEl.innerText = text;
            container.appendChild(toolEl);
            return;
        }

        // 如果是 assistant 并且仅仅是一个发起 tool_calls 的过渡消息，不显示它
        if (msg.role === 'assistant' && !msg.content && msg.tool_calls) {
            const toolEl = document.createElement('div');
            toolEl.className = 'chat-bubble-tool px-3 py-1.5 max-w-[85%] mx-auto select-none my-1';
            toolEl.innerText = `⚙️ AI 发起了 ${msg.tool_calls.length} 个模板修改任务...`;
            container.appendChild(toolEl);
            return;
        }

        const isUser = msg.role === 'user';
        const bubbleWrapper = document.createElement('div');
        bubbleWrapper.className = `flex ${isUser ? 'justify-end' : 'justify-start'} w-full items-start gap-2.5 my-2`;

        // 气泡头像
        let avatarHtml = '';
        if (!isUser) {
            avatarHtml = `
                <div class="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0 border border-purple-500/20">
                    <i data-lucide="bot" class="w-4 h-4"></i>
                </div>
            `;
        } else {
            avatarHtml = `
                <div class="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0 border border-blue-500/20 order-2">
                    <i data-lucide="user" class="w-4 h-4"></i>
                </div>
            `;
        }

        const canEditMessage = (isUser || msg.role === 'assistant') && !msg.tool_calls;
        const bubble = document.createElement('div');
        bubble.className = `max-w-[75%] px-4 py-3 text-xs leading-relaxed break-words whitespace-pre-wrap ${canEditMessage ? 'chat-bubble-editable pr-12' : ''} ${isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}`;

        const contentEl = document.createElement('div');
        contentEl.className = 'chat-message-content min-w-0';
        renderChatMessageContent(contentEl, msg.content || '');
        bubble.appendChild(contentEl);
        renderMessageAttachments(bubble, msg.attachments);

        // 双击删除消息重试（仅允许删除 user 消息和普通的 assistant 文本消息，绝对禁止删除 tool 或 assistant(tool_calls) 消息以防消息链断裂）
        const canDelete = (isUser || idx > 0) && msg.role !== 'tool' && !(msg.role === 'assistant' && msg.tool_calls);
        if (canDelete) {
            bubble.title = "双击删除此消息";
            bubble.ondblclick = () => {
                if (bubble.classList.contains('is-editing')) return;
                if (confirm("确定要删除这条消息吗？")) {
                    session.messages.splice(idx, 1);
                    saveChatSessions();
                    renderChatMessages();
                }
            };
        }
        if (canEditMessage) {
            attachChatMessageEditor(bubble, contentEl, msg, canDelete, isUser ? '用户消息' : 'AI 回复');
        }

        bubbleWrapper.innerHTML = avatarHtml;
        if (isUser) {
            bubbleWrapper.insertBefore(bubble, bubbleWrapper.firstChild);
        } else {
            bubbleWrapper.appendChild(bubble);
        }

        container.appendChild(bubbleWrapper);
    });

    container.scrollTop = container.scrollHeight;
    initLucide();
}

function handleChatInputKeydown(event) {
    const textarea = event.target;
    adjustTextareaHeight(textarea);

    updateChatSendButtonState();

    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (!isChatRequestRunning) {
            sendChatMessage();
        }
    }
}

function adjustTextareaHeight(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = (textarea.scrollHeight + 2) + 'px';
}

function appendChatThinkingBubble() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    const existing = document.getElementById('chat-thinking-bubble');
    if (existing) {
        updateChatThinkingBubbleText(currentChatThinkingText);
        return;
    }

    const thinkingWrapper = document.createElement('div');
    thinkingWrapper.id = 'chat-thinking-bubble';
    thinkingWrapper.className = 'flex justify-start w-full items-start gap-2.5 my-2';
    thinkingWrapper.innerHTML = `
        <div class="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0 border border-purple-500/20">
            <i data-lucide="bot" class="w-4 h-4"></i>
        </div>
        <div class="chat-bubble-assistant max-w-[75%] px-4 py-3 text-xs leading-relaxed flex items-center gap-2">
            <span id="thinking-text" class="text-slate-500 dark:text-slate-400">${escapeHtml(currentChatThinkingText)}</span>
            <div class="typing-dots flex gap-1">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    container.appendChild(thinkingWrapper);
    container.scrollTop = container.scrollHeight;
    initLucide();
}

function updateChatThinkingBubbleText(text) {
    currentChatThinkingText = text;
    const txtEl = document.getElementById('thinking-text');
    if (txtEl) txtEl.innerText = text;
}

function removeChatThinkingBubble() {
    const bubble = document.getElementById('chat-thinking-bubble');
    if (bubble) bubble.remove();
}

// 调度逻辑
async function handleToolCallsChain(toolCalls) {
    const results = [];
    for (const toolCall of toolCalls) {
        const name = toolCall.function.name;
        let args = {};
        try {
            args = JSON.parse(toolCall.function.arguments);
        } catch (e) {
            console.error("解析工具参数出错:", e);
        }
        
        console.log(`[AI-Chat-Tool] 正在调用本地工具: ${name}`, args);
        
        let result = { success: false, error: "未知工具" };
        if (name === "get_current_template_details") {
            result = executeTool_get_current_template_details();
        } else if (name === "update_template_title") {
            result = executeTool_update_template_title(args);
        } else if (name === "update_template_outline") {
            result = executeTool_update_template_outline(args);
        } else if (name === "update_frame_prompt_and_caption") {
            result = executeTool_update_frame_prompt_and_caption(args);
        } else if (name === "add_new_frame") {
            result = executeTool_add_new_frame(args);
        } else if (name === "delete_frame") {
            result = executeTool_delete_frame(args);
        } else if (name === "swap_frames") {
            result = executeTool_swap_frames(args);
        } else if (name === "batch_update_prompts_and_captions") {
            result = executeTool_batch_update_prompts_and_captions(args);
        }
        
        results.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: name,
            content: JSON.stringify(result)
        });
    }
    return results;
}

async function sendChatMessage() {
    const inputEl = document.getElementById('chat-user-input');
    const sendBtn = document.getElementById('chat-send-btn');
    if (!inputEl || !sendBtn) return;
    if (isChatRequestRunning) {
        stopChatMessage();
        return;
    }
    
    const userText = inputEl.value.trim();
    const attachments = pendingChatAttachments.map(att => ({ ...att }));
    if (!userText && attachments.length === 0) return;

    // 获取当前会话。固定请求所属会话，避免用户在等待期间切换会话后串写回复。
    let session = chatSessions.find(s => s.id === activeChatSessionId);
    if (!session) return;
    const requestSessionId = session.id;
    
    // 清空输入框和待发送附件
    inputEl.value = '';
    pendingChatAttachments = [];
    renderPendingChatAttachments();
    chatRequestAbortController = new AbortController();
    chatStopRequested = false;
    isChatRequestRunning = true;
    activeChatRequestSessionId = requestSessionId;
    currentChatThinkingText = "AI 正在思考中...";
    updateChatSendButtonState();
    adjustTextareaHeight(inputEl);

    // 追加 user 消息
    session.messages.push({
        role: 'user',
        content: userText || '请参考上传附件。',
        attachments
    });
    renderChatMessages();
    saveChatSessions();
    
    // 追加 Thinking / Loading 气泡
    appendChatThinkingBubble();
    
    try {
        let finished = false;
        let responseMessage = null;
        let callDepth = 0;
        const MAX_TOOL_CALL_DEPTH = 5;
        
        // 循环直到大模型不再返回 tool_calls，或达到深度上限
        while (!finished) {
            if (chatStopRequested) {
                throw new DOMException("用户已停止 AI 输出", "AbortError");
            }
            if (callDepth >= MAX_TOOL_CALL_DEPTH) {
                console.warn("[AI-Chat] 工具链连续调用达到深度上限，强行中止");
                session.messages.push({
                    role: 'assistant',
                    content: "⚠️ 提示：AI 工具连续调用次数已达到安全阈值限制（5次），为避免死循环，处理已强行中止。请检查大纲或分镜格式是否符合要求。"
                });
                finished = true;
                break;
            }

            responseMessage = await requestLlmChatWithTools(session.messages, {
                signal: chatRequestAbortController.signal
            });
            session = chatSessions.find(s => s.id === requestSessionId);
            if (!session) {
                throw new Error("当前精修会话已不存在，AI 回复无法写入。");
            }
            const hasToolCalls = Array.isArray(responseMessage.tool_calls) && responseMessage.tool_calls.length > 0;
            const assistantContent = typeof responseMessage.content === 'string' ? responseMessage.content : '';
            const hasAssistantContent = assistantContent.trim().length > 0;
            
            if (hasAssistantContent || hasToolCalls) {
                // 将 AI 的响应追加到消息流中
                session.messages.push({
                    role: 'assistant',
                    content: assistantContent,
                    tool_calls: hasToolCalls ? responseMessage.tool_calls : undefined
                });
            } else if (callDepth === 0) {
                session.messages.push({
                    role: 'assistant',
                    content: "AI 没有返回文字内容，请重试或补充更具体的修改要求。"
                });
            }

            if (hasToolCalls) {
                callDepth++;
                // 更新 Thinking 气泡为“正在执行工具修改...”
                updateChatThinkingBubbleText(`AI 正在执行工具修改中 (${callDepth}/${MAX_TOOL_CALL_DEPTH})...`);
                
                // 执行工具调用链
                const toolResults = await handleToolCallsChain(responseMessage.tool_calls);
                if (chatStopRequested) {
                    throw new DOMException("用户已停止 AI 输出", "AbortError");
                }
                
                // 将工具调用的执行结果追加到消息流中
                session.messages.push(...toolResults);
                
                // 刷新消息界面，展示调用动作
                renderChatMessages();
                if (activeChatSessionId === requestSessionId) {
                    appendChatThinkingBubble();
                }
                saveChatSessions();
            } else {
                finished = true;
            }
        }
        
        // 去除 Thinking 气泡
        removeChatThinkingBubble();
        
        // 渲染最新消息
        renderChatMessages();
        saveChatSessions();
        
    } catch (err) {
        removeChatThinkingBubble();
        if (err.name === 'AbortError') {
            console.info("[AI-Chat] 用户已停止当前输出");
            return;
        }
        console.error("AI 聊天助手遇到错误:", err);
        session.messages.push({
            role: 'assistant',
            content: `❌ 精修请求失败: ${err.message}`
        });
        renderChatMessages();
        saveChatSessions();
    } finally {
        isChatRequestRunning = false;
        activeChatRequestSessionId = null;
        chatRequestAbortController = null;
        chatStopRequested = false;
        updateChatSendButtonState();
    }
}

// 占位符校验辅助函数
function validatePromptPlaceholders(prompt) {
    if (!prompt) return { valid: true };
    
    // 检测大括号是否成对出现
    let openBraces = 0;
    for (let i = 0; i < prompt.length; i++) {
        if (prompt[i] === '{') openBraces++;
        if (prompt[i] === '}') {
            openBraces--;
            if (openBraces < 0) return { valid: false, error: "提示词中存在未配对的闭合大括号 '}'" };
        }
    }
    if (openBraces > 0) {
        return { valid: false, error: "提示词中存在未闭合的开始大括号 '{'" };
    }
    
    const placeholders = extractPromptPlaceholderNames(prompt);
    if (placeholders.length === 0) {
        return { valid: false, error: "提示词中至少需要包含一个大括号变量占位符，例如 '{character1}'、'{character2}' 或 '{style}'" };
    }

    const invalidPlaceholder = placeholders.find(name => !isMatrixVariableName(name));
    if (invalidPlaceholder) {
        return { valid: false, error: `占位符 '{${invalidPlaceholder}}' 命名无效。请仅使用字母、数字或下划线，例如 '{character1}'` };
    }
    
    return { valid: true };
}

// 挂载工具的执行函数
function executeTool_get_current_template_details() {
    syncDomToActiveTemplate();
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) {
        return { success: false, error: "没有激活选中的模板，请先在左侧选择或创建一个模板！" };
    }
    return {
        success: true,
        templateId: t.id,
        title: t.title,
        desc: t.desc,
        stepsCount: t.steps.length,
        steps: t.steps
    };
}

function executeTool_update_template_title(args) {
    syncDomToActiveTemplate();
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return { success: false, error: "未找到当前激活的模板" };
    t.title = args.title;
    populateActiveTemplateSteps();
    saveTemplatesToStorage();
    renderTemplatesList();
    populateTemplateDropdowns();
    return { success: true, message: `模板标题已成功修改为 "${args.title}"` };
}

function executeTool_update_template_outline(args) {
    syncDomToActiveTemplate();
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return { success: false, error: "未找到当前激活的模板" };
    t.desc = args.outline;
    
    // 更新 DOM
    const descEl = document.getElementById('tpl-desc-input');
    if (descEl) descEl.value = args.outline;
    
    populateActiveTemplateSteps();
    saveTemplatesToStorage();
    return { success: true, message: `模板主线思路大纲已成功更新` };
}

function executeTool_update_frame_prompt_and_caption(args) {
    syncDomToActiveTemplate();
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return { success: false, error: "未找到当前激活的模板" };
    const idx = args.frameIndex;
    if (idx < 0 || idx >= t.steps.length) {
        return { success: false, error: `无效的分镜索引 frameIndex: ${idx}，当前总幕数为 ${t.steps.length} 幕` };
    }
    
    // 变量占位符防御校验
    if (args.prompt !== undefined) {
        const val = validatePromptPlaceholders(args.prompt);
        if (!val.valid) {
            return { success: false, error: `占位符校验未通过: ${val.error}。请重新润色提示词并保留合法变量占位符。` };
        }
    }

    if (args.name !== undefined) t.steps[idx].name = args.name;
    if (args.prompt !== undefined) t.steps[idx].prompt = args.prompt;
    if (args.caption !== undefined) t.steps[idx].caption = args.caption;
    
    populateActiveTemplateSteps();
    saveTemplatesToStorage();
    return { success: true, message: `分镜 ${idx + 1} (${t.steps[idx].name}) 已成功更新` };
}

function executeTool_add_new_frame(args) {
    syncDomToActiveTemplate();
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return { success: false, error: "未找到当前激活的模板" };
    
    // 变量占位符校验
    const val = validatePromptPlaceholders(args.prompt);
    if (!val.valid) {
        return { success: false, error: `占位符校验未通过: ${val.error}。请确保新建分镜提示词里包含合法变量占位符。` };
    }

    const newStep = {
        name: args.name,
        prompt: args.prompt,
        caption: args.caption
    };
    
    const insertIdx = args.insertIndex;
    if (insertIdx !== undefined && insertIdx >= 0 && insertIdx <= t.steps.length) {
        t.steps.splice(insertIdx, 0, newStep);
    } else {
        t.steps.push(newStep);
    }
    
    populateActiveTemplateSteps();
    saveTemplatesToStorage();
    return { success: true, message: `成功添加新分镜到位置 ${insertIdx !== undefined ? insertIdx : t.steps.length - 1}` };
}

function executeTool_delete_frame(args) {
    syncDomToActiveTemplate();
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return { success: false, error: "未找到当前激活的模板" };
    
    // 最少 1 个分镜安全防御
    if (t.steps.length <= 1) {
        return { success: false, error: "漫画模板必须至少包含一幕分镜，不允许再继续删除！" };
    }

    const idx = args.frameIndex;
    if (idx < 0 || idx >= t.steps.length) {
        return { success: false, error: `无效的分镜索引 frameIndex: ${idx}` };
    }
    const deletedName = t.steps[idx].name;
    t.steps.splice(idx, 1);
    populateActiveTemplateSteps();
    saveTemplatesToStorage();
    return { success: true, message: `成功删除分镜 ${idx + 1} (${deletedName})` };
}

function executeTool_swap_frames(args) {
    syncDomToActiveTemplate();
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return { success: false, error: "未找到当前激活的模板" };
    const idxA = args.indexA;
    const idxB = args.indexB;
    if (idxA < 0 || idxA >= t.steps.length || idxB < 0 || idxB >= t.steps.length) {
        return { success: false, error: "无效的分镜索引" };
    }
    const tempStep = t.steps[idxA];
    t.steps[idxA] = t.steps[idxB];
    t.steps[idxB] = tempStep;
    populateActiveTemplateSteps();
    saveTemplatesToStorage();
    return { success: true, message: `成功交换分镜 ${idxA + 1} 与 ${idxB + 1} 的顺序` };
}

function executeTool_batch_update_prompts_and_captions(args) {
    syncDomToActiveTemplate();
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return { success: false, error: "未找到当前激活的模板" };
    
    const frames = args.frames;
    if (!Array.isArray(frames)) {
        return { success: false, error: "frames 参数必须是数组" };
    }
    
    // 批量校验占位符
    for (const item of frames) {
        if (item.prompt !== undefined) {
            const val = validatePromptPlaceholders(item.prompt);
            if (!val.valid) {
                return { success: false, error: `分镜索引 ${item.frameIndex} 占位符校验未通过: ${val.error}。批量操作已安全终止。` };
            }
        }
    }

    let updatedCount = 0;
    frames.forEach(item => {
        const idx = item.frameIndex;
        if (idx >= 0 && idx < t.steps.length) {
            if (item.prompt !== undefined) t.steps[idx].prompt = item.prompt;
            if (item.caption !== undefined) t.steps[idx].caption = item.caption;
            updatedCount++;
        }
    });
    
    populateActiveTemplateSteps();
    saveTemplatesToStorage();
    return { success: true, message: `成功批量更新了 ${updatedCount} 幕分镜数据` };
}

// 绑定全局挂载
window.openChatRefinementModal = openChatRefinementModal;
window.closeChatRefinementModal = closeChatRefinementModal;
window.createNewChatSession = createNewChatSession;
window.deleteChatSession = deleteChatSession;
window.clearCurrentSessionMessages = clearCurrentSessionMessages;
window.sendChatMessage = sendChatMessage;
window.handleChatInputKeydown = handleChatInputKeydown;
window.toggleChatSystemPromptPanel = toggleChatSystemPromptPanel;
window.closeChatSystemPromptPanel = closeChatSystemPromptPanel;
window.handleChatSystemPromptInput = handleChatSystemPromptInput;
window.saveChatSystemPromptEditor = saveChatSystemPromptEditor;
window.resetChatSystemPromptToDefault = resetChatSystemPromptToDefault;
window.syncChatSystemPromptSnapshot = syncChatSystemPromptSnapshot;
window.openChatAttachmentPicker = openChatAttachmentPicker;
window.handleChatAttachmentUpload = handleChatAttachmentUpload;
window.removePendingChatAttachment = removePendingChatAttachment;
