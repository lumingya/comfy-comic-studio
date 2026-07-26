// js/core.js - 全局状态、通用工具、配置读写与应用启动引导。
// 该文件必须最先加载：其余模块共享它在此声明的顶层 let/const 绑定。

// app.js - 核心生命周期与交互管线大控制器

// Data Structures & State
window.isAppInitializing = true;
let templates = [];
let activeTemplateId = null;
const DEFAULT_MATRIX_COLUMNS = ["character", "style", "outfit"];
const MATRIX_RESERVED_FIELDS = new Set(["id", "active", "bookTitle", "captions", "storyVersions", "activeStoryVersionIds"]);
const MATRIX_VARIABLE_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;
let batchMatrix = {
    columns: DEFAULT_MATRIX_COLUMNS.slice(),
    rows: []
};
let comfyWorkflows = []; // [{ id: "wf_xxx", name: "工作流一", raw: {...}, nodePositive: "6", nodeNegative: "", nodeOutput: "9" }]
let activeWorkflowId = null;
let comfyWorkflowRaw = null; 
let isMockMode = false;
let runningBatch = false;
let cancelRequested = false;
let savedGalleries = [];
let shouldSaveAfterInitialization = false;
const BATCH_STATE_KEY = 'comfy_comic_batch_state';
const BATCH_SESSION_ID = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let appReadyPromise = Promise.resolve();
let batchRunState = createEmptyBatchRunState();

// 100% 离线安全、高度容错的纯本地 SVG 矢量降级占位图（替代外网 Unsplash 地址）
const OFFLINE_PLACEHOLDER_IMAGE = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="100%" height="100%" fill="%230f172a"/><g transform="translate(300, 200)" text-anchor="middle" fill="%2364748b"><rect x="-80" y="-80" width="160" height="160" rx="16" fill="%231e293b" stroke="%23334155" stroke-width="2"/><circle cx="0" cy="-15" r="24" fill="none" stroke="%2364748b" stroke-width="4"/><path d="M-40,40 L40,40 L25,15 L5,25 L-20,0 Z" fill="%2364748b"/><text y="120" font-size="15" font-family="system-ui, sans-serif" font-weight="bold" fill="%2394a3b8">图片绘制失败 (已安全降级)</text><text y="145" font-size="11" font-family="system-ui, sans-serif" fill="%23475569">本地服务离线或 ComfyUI 轮询超时</text></g></svg>`;

// 演示/占位画面一律本地生成，绝不引用外网图床：断网、内网、CDN 被墙时首屏都不会出现破图。
const PLACEHOLDER_PALETTES = [
    ['%23312e81', '%230ea5e9'],
    ['%237c2d12', '%23f59e0b'],
    ['%23134e4a', '%2334d399'],
    ['%234c1d95', '%23f472b6'],
    ['%23172554', '%2360a5fa'],
    ['%233f1d38', '%23c084fc']
];

function stableStringHash(seed) {
    const text = String(seed ?? '');
    let hash = 0;
    for (let idx = 0; idx < text.length; idx++) {
        hash = ((hash * 31) + text.charCodeAt(idx)) >>> 0;
    }
    return hash;
}

// 生成一张确定性的本地矢量占位画面。同一个 seed 永远得到同一张图，
// 因此模拟模式重复运行的结果是可复现的。
function makeLocalArtPlaceholder(seed, label = '') {
    const hash = stableStringHash(seed);
    const [from, to] = PLACEHOLDER_PALETTES[hash % PLACEHOLDER_PALETTES.length];
    const gradientId = `g${hash % 100000}`;
    const angle = hash % 360;
    const blobs = [0, 1, 2].map(i => {
        const h = stableStringHash(`${seed}:${i}`);
        return `<circle cx="${80 + (h % 440)}" cy="${60 + ((h >> 7) % 280)}" r="${40 + ((h >> 3) % 90)}" fill="%23ffffff" opacity="0.07"/>`;
    }).join('');
    const caption = escapeXmlAttribute(String(label || '').slice(0, 22));
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">`
        + `<defs><linearGradient id="${gradientId}" gradientTransform="rotate(${angle})"><stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient></defs>`
        + `<rect width="100%" height="100%" fill="url(%23${gradientId})"/>${blobs}`
        + `<g text-anchor="middle" font-family="system-ui, sans-serif" fill="%23ffffff">`
        + `<text x="300" y="205" font-size="13" opacity="0.55" letter-spacing="3">MOCK RENDER</text>`
        + (caption ? `<text x="300" y="235" font-size="16" font-weight="bold" opacity="0.9">${caption}</text>` : '')
        + `</g></svg>`;
}

// data URL 里的 SVG 不经过 HTML 解析器，需要按 XML 规则转义，并回避会截断 URL 的字符。
function escapeXmlAttribute(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        .replace(/#/g, '%23')
        .replace(/\s+/g, ' ');
}

window.makeLocalArtPlaceholder = makeLocalArtPlaceholder;
window.OFFLINE_PLACEHOLDER_IMAGE = OFFLINE_PLACEHOLDER_IMAGE;


// Helper to escape HTML to prevent DOM-based XSS
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function inlineJsString(value) {
    return escapeHtml(JSON.stringify(String(value ?? '')));
}

function isMatrixVariableName(name) {
    return MATRIX_VARIABLE_NAME_PATTERN.test(String(name || ''));
}

function sanitizeMatrixVariableName(name) {
    return String(name || '')
        .trim()
        .replace(/[{}]/g, '')
        .replace(/[^a-zA-Z0-9_]/g, '');
}

function normalizeBatchMatrixState() {
    if (!batchMatrix || typeof batchMatrix !== 'object') {
        batchMatrix = { columns: [], rows: [] };
    }

    const rows = Array.isArray(batchMatrix.rows) ? batchMatrix.rows : [];
    const collectedColumns = [];
    const addColumn = (rawName) => {
        const name = sanitizeMatrixVariableName(rawName);
        if (!name || MATRIX_RESERVED_FIELDS.has(name) || !isMatrixVariableName(name)) return;
        if (!collectedColumns.includes(name)) collectedColumns.push(name);
    };

    DEFAULT_MATRIX_COLUMNS.forEach(addColumn);
    if (Array.isArray(batchMatrix.columns)) {
        batchMatrix.columns.forEach(addColumn);
    }
    rows.forEach(row => {
        if (!row || typeof row !== 'object') return;
        Object.keys(row).forEach(key => {
            if (!MATRIX_RESERVED_FIELDS.has(key) && isMatrixVariableName(key)) {
                addColumn(key);
            }
        });
    });

    batchMatrix.columns = collectedColumns;
    batchMatrix.rows = rows
        .filter(row => row && typeof row === 'object')
        .map((row, idx) => {
            if (!row.id) row.id = `row_${Date.now()}_${idx}`;
            if (row.active === undefined) row.active = true;
            if (row.bookTitle === undefined || row.bookTitle === null) row.bookTitle = '';
            if (!row.captions || typeof row.captions !== 'object' || Array.isArray(row.captions)) {
                row.captions = {};
            }
            if (!row.storyVersions || typeof row.storyVersions !== 'object' || Array.isArray(row.storyVersions)) {
                row.storyVersions = {};
            }
            if (!row.activeStoryVersionIds || typeof row.activeStoryVersionIds !== 'object' || Array.isArray(row.activeStoryVersionIds)) {
                row.activeStoryVersionIds = {};
            }
            normalizeRowStoryVersions(row);
            batchMatrix.columns.forEach(col => {
                if (row[col] === undefined || row[col] === null) row[col] = '';
            });
            return row;
        });
}

function getMatrixColumnHeaderMeta(col) {
    const lower = String(col || '').toLowerCase();
    if (/^character\d*$/.test(lower)) {
        return {
            label: lower === 'character' ? '人物核心特征' : '人物占位符',
            className: 'text-blue-400',
            minWidthClass: 'min-w-[150px]'
        };
    }
    if (lower === 'style') {
        return {
            label: '画风',
            className: 'text-indigo-400',
            minWidthClass: 'min-w-[120px]'
        };
    }
    if (lower === 'outfit') {
        return {
            label: '服装/造型',
            className: 'text-pink-400',
            minWidthClass: 'min-w-[120px]'
        };
    }
    return {
        label: '自定义变量',
        className: 'text-purple-400',
        minWidthClass: 'min-w-[120px]'
    };
}

function renderMatrixTableHeader() {
    const headerRow = document.getElementById('matrix-header-row');
    if (!headerRow) return;

    const variableHeaders = batchMatrix.columns.map(col => {
        const meta = getMatrixColumnHeaderMeta(col);
        return `
            <th class="p-3 ${meta.minWidthClass} ${meta.className} font-mono">
                <div>{${escapeHtml(col)}}</div>
                <div class="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500 font-semibold">${escapeHtml(meta.label)}</div>
            </th>
        `;
    }).join('');

    headerRow.innerHTML = `
        <th class="p-3 w-12 text-center">启用</th>
        <th class="p-3 w-36">画册标题/概念名称</th>
        ${variableHeaders}
        <th class="p-3 w-16 text-center">操作</th>
    `;
}

// 全局主线大纲：显式填写的优先，否则退回模板自身的简介（模板编辑器里那一栏
// 的提示语就是“在这里描述这个连环画的主线思路”，本来就是干这个用的）。
// 在此之前 story.js 每次都硬编码传空字符串，大模型拿到的主线永远是空的。
function resolveGlobalStoryOutline(tpl = null) {
    const explicit = String(getElementValue('global-story-prompt', '') || '').trim();
    if (explicit) return explicit;
    return String(tpl?.desc || '').trim();
}

function replaceTemplatePlaceholders(text, row) {
    let result = text === null || text === undefined ? '' : String(text);
    const sourceRow = row || {};
    const columns = Array.isArray(batchMatrix.columns) ? batchMatrix.columns : [];

    columns.forEach(col => {
        const replaceVal = sourceRow[col] === null || sourceRow[col] === undefined ? '' : String(sourceRow[col]);
        result = result.split(`{${col}}`).join(replaceVal);
    });
    result = result.split('{bookTitle}').join(sourceRow.bookTitle === null || sourceRow.bookTitle === undefined ? '' : String(sourceRow.bookTitle));
    return result;
}

function normalizeCaptionArray(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(value, item => item === null || item === undefined ? '' : String(item));
}

function createStoryVersionId() {
    return `story_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatStoryVersionTime(timestamp) {
    const date = new Date(Number(timestamp) || Date.now());
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function makeStoryVersionTitle(row, tpl, prefix = '剧情') {
    const tplId = tpl?.id || '';
    const nextIndex = getStoryVersions(row, tplId).length + 1;
    return `${prefix} ${nextIndex} · ${formatStoryVersionTime(Date.now())}`;
}

function normalizeStoryVersion(raw, tplId, idx) {
    const now = Date.now();
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        id: source.id ? String(source.id) : createStoryVersionId(),
        title: source.title ? String(source.title) : `剧情 ${idx + 1}`,
        templateId: source.templateId || tplId,
        templateTitle: source.templateTitle || '',
        source: source.source || 'manual',
        createdAt: Number(source.createdAt) || now,
        updatedAt: Number(source.updatedAt) || Number(source.createdAt) || now,
        captions: normalizeCaptionArray(source.captions)
    };
}

function normalizeRowStoryVersions(row) {
    if (!row || typeof row !== 'object') return;
    if (!row.captions || typeof row.captions !== 'object' || Array.isArray(row.captions)) row.captions = {};
    if (!row.storyVersions || typeof row.storyVersions !== 'object' || Array.isArray(row.storyVersions)) row.storyVersions = {};
    if (!row.activeStoryVersionIds || typeof row.activeStoryVersionIds !== 'object' || Array.isArray(row.activeStoryVersionIds)) row.activeStoryVersionIds = {};

    Object.keys(row.captions).forEach(tplId => {
        const legacyCaptions = normalizeCaptionArray(row.captions[tplId]);
        row.captions[tplId] = legacyCaptions;
        if (legacyCaptions.length > 0 && (!Array.isArray(row.storyVersions[tplId]) || row.storyVersions[tplId].length === 0)) {
            const legacyId = `legacy_${tplId}`;
            row.storyVersions[tplId] = [{
                id: legacyId,
                title: '默认剧情',
                templateId: tplId,
                source: 'legacy',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                captions: legacyCaptions.slice()
            }];
            row.activeStoryVersionIds[tplId] = legacyId;
        }
    });

    Object.keys(row.storyVersions).forEach(tplId => {
        const rawVersions = Array.isArray(row.storyVersions[tplId]) ? row.storyVersions[tplId] : [];
        const seenIds = new Set();
        const versions = rawVersions
            .map((version, idx) => normalizeStoryVersion(version, tplId, idx))
            .map(version => {
                if (seenIds.has(version.id)) {
                    version.id = createStoryVersionId();
                }
                seenIds.add(version.id);
                return version;
            });

        row.storyVersions[tplId] = versions;
        const activeId = row.activeStoryVersionIds[tplId];
        const activeVersion = versions.find(version => version.id === activeId) || versions[0] || null;
        if (activeVersion) {
            row.activeStoryVersionIds[tplId] = activeVersion.id;
            row.captions[tplId] = activeVersion.captions.slice();
        }
    });
}

function getStoryVersions(row, tplId) {
    if (!row || !tplId) return [];
    normalizeRowStoryVersions(row);
    if (!Array.isArray(row.storyVersions[tplId])) row.storyVersions[tplId] = [];
    return row.storyVersions[tplId];
}

function getActiveStoryVersion(row, tplId) {
    const versions = getStoryVersions(row, tplId);
    if (versions.length === 0) return null;
    const activeId = row.activeStoryVersionIds?.[tplId];
    const activeVersion = versions.find(version => version.id === activeId) || versions[0];
    row.activeStoryVersionIds[tplId] = activeVersion.id;
    row.captions[tplId] = activeVersion.captions.slice();
    return activeVersion;
}

function getStoryVersionById(row, tplId, storyId) {
    return getStoryVersions(row, tplId).find(version => version.id === storyId) || null;
}

function setActiveStoryVersion(row, tplId, storyId) {
    const version = getStoryVersionById(row, tplId, storyId);
    if (!version) return null;
    row.activeStoryVersionIds[tplId] = version.id;
    row.captions[tplId] = version.captions.slice();
    return version;
}

function getActiveStoryCaptions(row, tplId) {
    const activeVersion = getActiveStoryVersion(row, tplId);
    if (activeVersion) return activeVersion.captions;
    if (row?.captions && Array.isArray(row.captions[tplId])) return row.captions[tplId];
    return [];
}

function createStoryVersion(row, tplId, tpl, captions = [], options = {}) {
    if (!row || !tplId) return null;
    normalizeRowStoryVersions(row);

    const now = Date.now();
    const version = {
        id: createStoryVersionId(),
        title: options.title || makeStoryVersionTitle(row, tpl, options.prefix || '剧情'),
        templateId: tplId,
        templateTitle: tpl?.title || options.templateTitle || '',
        source: options.source || 'manual',
        createdAt: now,
        updatedAt: now,
        captions: normalizeCaptionArray(captions)
    };

    if (!Array.isArray(row.storyVersions[tplId])) row.storyVersions[tplId] = [];
    row.storyVersions[tplId].unshift(version);
    row.activeStoryVersionIds[tplId] = version.id;
    row.captions[tplId] = version.captions.slice();
    return version;
}

function ensureEditableStoryVersion(row, tplId, tpl, options = {}) {
    const existing = getActiveStoryVersion(row, tplId);
    if (existing) return existing;

    const fallbackCaptions = Array.isArray(options.fallbackCaptions) ? options.fallbackCaptions : [];
    return createStoryVersion(row, tplId, tpl, fallbackCaptions, {
        source: options.source || 'manual',
        prefix: options.prefix || '剧情'
    });
}

function updateStoryVersionCaptions(row, tplId, tpl, captions, options = {}) {
    const version = ensureEditableStoryVersion(row, tplId, tpl, options);
    if (!version) return null;

    version.captions = normalizeCaptionArray(captions);
    version.updatedAt = Date.now();
    if (options.title) version.title = options.title;
    if (options.source) version.source = options.source;
    row.activeStoryVersionIds[tplId] = version.id;
    row.captions[tplId] = version.captions.slice();
    return version;
}

function updateStoryVersionCaptionAt(row, tplId, tpl, stepIdx, textVal, options = {}) {
    const currentCaptions = getActiveStoryCaptions(row, tplId).slice();
    currentCaptions[stepIdx] = textVal;
    return updateStoryVersionCaptions(row, tplId, tpl, currentCaptions, options);
}

function extractPromptPlaceholderNames(text) {
    const names = [];
    String(text || '').replace(/\{([^{}]+)\}/g, (_, name) => {
        names.push(String(name || '').trim());
        return _;
    });
    return names;
}

function getPrimaryCharacterLabel(row) {
    if (!row) return '未命名角色';
    const characterColumns = (Array.isArray(batchMatrix.columns) ? batchMatrix.columns : [])
        .filter(col => /^character\d*$/i.test(col));

    for (const col of characterColumns) {
        const value = String(row[col] || '').trim();
        if (value) return value;
    }

    return String(row.bookTitle || '未命名角色').trim();
}

function isLegacyXmlTemplatePrompt(text) {
    if (!text) return false;
    return text.includes('XML 根标签为 <模板1>') && text.includes('<分镜>') && text.includes('{panelCount}');
}

function syncXmlSystemPromptInput() {
    const input = document.getElementById('xml-system-prompt');
    if (!input) return;

    const defaultPrompt = window.DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT || '';
    const storedPrompt = localStorage.getItem('xml_system_prompt');
    const shouldUpgrade = !storedPrompt || isLegacyXmlTemplatePrompt(storedPrompt);
    const nextPrompt = shouldUpgrade ? defaultPrompt : storedPrompt;

    input.value = nextPrompt;

    if (nextPrompt !== storedPrompt) {
        localStorage.setItem('xml_system_prompt', nextPrompt);
        updateLastActiveTime();
        saveConfigToComfyServer();
    }
}

function getElementValue(id, fallback = '') {
    const el = document.getElementById(id);
    if (!el) return fallback;
    return el.value !== undefined ? el.value : fallback;
}

function setElementValue(id, value) {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null) return;
    el.value = value;
}

function setSelectValueSafely(id, value) {
    const el = document.getElementById(id);
    if (!el || el.tagName !== 'SELECT') return;

    const options = Array.from(el.options || []);
    if (value && options.some(option => option.value === value)) {
        el.value = value;
    } else if (options.length > 0 && !options.some(option => option.selected)) {
        el.value = options[0].value;
    } else if (options.length > 0 && !el.value) {
        el.value = options[0].value;
    }
}

function getCheckboxValue(id, fallback = false) {
    const el = document.getElementById(id);
    return el ? !!el.checked : fallback;
}

function setCheckboxValue(id, value) {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null) return;
    el.checked = !!value;
}

function parseLocalStorageJson(key, fallback = null) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
        console.warn(`[Config] Failed to parse ${key}:`, err.message);
        return fallback;
    }
}

function writeLocalStorageJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function getCurrentTheme() {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyThemeConfig(theme) {
    if (!theme) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
}

function getLlmConfigFromDom() {
    return {
        provider: getElementValue('llm-provider', localStorage.getItem('llm_provider') || 'openai'),
        modelName: getElementValue('llm-model-name', localStorage.getItem('llm_model_name') || 'gpt-4o'),
        baseUrl: getElementValue('llm-base-url', localStorage.getItem('llm_base_url') || 'https://api.openai.com/v1'),
        apiKey: getElementValue('llm-api-key', localStorage.getItem('llm_api_key') || ''),
        systemPrompt: getElementValue('llm-system-prompt', localStorage.getItem('llm_system_prompt') || ''),
        chunkSize: parseInt(getElementValue('llm-chunk-size', localStorage.getItem('llm_chunk_size') || '10'), 10) || 10
    };
}

function syncLlmConfigToLocalStorage(config) {
    if (!config || typeof config !== 'object') return;
    localStorage.setItem('llm_provider', config.provider || 'openai');
    localStorage.setItem('llm_model_name', config.modelName || 'gpt-4o');
    localStorage.setItem('llm_base_url', config.baseUrl || 'https://api.openai.com/v1');
    localStorage.setItem('llm_api_key', config.apiKey || '');
    localStorage.setItem('llm_system_prompt', config.systemPrompt || '');
    localStorage.setItem('llm_chunk_size', String(config.chunkSize || 10));
}

function applyLlmConfig(config = {}) {
    const merged = {
        provider: localStorage.getItem('llm_provider') || 'openai',
        modelName: localStorage.getItem('llm_model_name') || getElementValue('llm-model-name', 'gpt-4o'),
        baseUrl: localStorage.getItem('llm_base_url') || getElementValue('llm-base-url', 'https://api.openai.com/v1'),
        apiKey: localStorage.getItem('llm_api_key') || '',
        systemPrompt: localStorage.getItem('llm_system_prompt') || getElementValue('llm-system-prompt', ''),
        chunkSize: parseInt(localStorage.getItem('llm_chunk_size') || getElementValue('llm-chunk-size', '10'), 10) || 10,
        ...config
    };

    setElementValue('llm-provider', merged.provider);
    setElementValue('llm-model-name', merged.modelName);
    setElementValue('llm-base-url', merged.baseUrl);
    setElementValue('llm-api-key', merged.apiKey);
    setElementValue('llm-system-prompt', merged.systemPrompt);
    setElementValue('llm-chunk-size', String(merged.chunkSize || 10));
    syncLlmConfigToLocalStorage(merged);
}

function saveLlmConfigFromDom() {
    syncLlmConfigToLocalStorage(getLlmConfigFromDom());
    saveConfigToComfyServer();
}

function getComfyConfigFromDom() {
    return {
        baseUrl: getElementValue('comfy-url-input', localStorage.getItem('comfy_api_url') || 'http://127.0.0.1:8188'),
        isMockMode: getCheckboxValue('engine-mock-toggle', localStorage.getItem('comfy_is_mock') === 'true'),
        nodePositive: getElementValue('node-id-positive', localStorage.getItem('comfy_node_positive') || '6'),
        nodeNegative: getElementValue('node-id-negative', localStorage.getItem('comfy_node_negative') || ''),
        nodeOutput: getElementValue('node-id-output', localStorage.getItem('comfy_node_output') || '9')
    };
}

function syncComfyConfigToLocalStorage(config) {
    if (!config || typeof config !== 'object') return;
    localStorage.setItem('comfy_api_url', config.baseUrl || 'http://127.0.0.1:8188');
    localStorage.setItem('comfy_is_mock', String(!!config.isMockMode));
    localStorage.setItem('comfy_node_positive', config.nodePositive || '6');
    localStorage.setItem('comfy_node_negative', config.nodeNegative || '');
    localStorage.setItem('comfy_node_output', config.nodeOutput || '9');
}

function applyComfyConfig(config = {}) {
    const merged = {
        baseUrl: localStorage.getItem('comfy_api_url') || getElementValue('comfy-url-input', 'http://127.0.0.1:8188'),
        isMockMode: localStorage.getItem('comfy_is_mock') === 'true',
        nodePositive: localStorage.getItem('comfy_node_positive') || getElementValue('node-id-positive', '6'),
        nodeNegative: localStorage.getItem('comfy_node_negative') || getElementValue('node-id-negative', ''),
        nodeOutput: localStorage.getItem('comfy_node_output') || getElementValue('node-id-output', '9'),
        ...config
    };

    setElementValue('comfy-url-input', merged.baseUrl);
    setCheckboxValue('engine-mock-toggle', merged.isMockMode);
    setElementValue('node-id-positive', merged.nodePositive);
    setElementValue('node-id-negative', merged.nodeNegative);
    setElementValue('node-id-output', merged.nodeOutput);
    isMockMode = !!merged.isMockMode;
    syncComfyConfigToLocalStorage(merged);
}

function saveComfyConfigFromDom() {
    const config = getComfyConfigFromDom();
    isMockMode = !!config.isMockMode;
    syncComfyConfigToLocalStorage(config);
    saveConfigToComfyServer();
}

function getXmlConfigFromDom() {
    const outputText = getElementValue('xml-output-textarea', '');
    return {
        templatePrompt: getElementValue('xml-template-prompt', localStorage.getItem('xml_template_prompt') || ''),
        panelCount: parseInt(getElementValue('xml-template-count', localStorage.getItem('xml_template_count') || '30'), 10) || 30,
        reuseMainApi: getCheckboxValue('xml-reuse-api-cfg', localStorage.getItem('xml_reuse_api_cfg') !== 'false'),
        provider: getElementValue('xml-llm-provider', localStorage.getItem('xml_llm_provider') || 'openai'),
        modelName: getElementValue('xml-llm-model', localStorage.getItem('xml_llm_model') || 'gpt-4o'),
        baseUrl: getElementValue('xml-llm-base-url', localStorage.getItem('xml_llm_base_url') || 'https://api.openai.com/v1'),
        apiKey: getElementValue('xml-llm-api-key', localStorage.getItem('xml_llm_api_key') || ''),
        systemPrompt: getElementValue('xml-system-prompt', localStorage.getItem('xml_system_prompt') || (window.DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT || '')),
        lastOutput: outputText
    };
}

function syncXmlConfigToLocalStorage(config) {
    if (!config || typeof config !== 'object') return;
    localStorage.setItem('xml_template_prompt', config.templatePrompt || '');
    localStorage.setItem('xml_template_count', String(config.panelCount || 30));
    localStorage.setItem('xml_reuse_api_cfg', String(config.reuseMainApi !== false));
    localStorage.setItem('xml_llm_provider', config.provider || 'openai');
    localStorage.setItem('xml_llm_model', config.modelName || 'gpt-4o');
    localStorage.setItem('xml_llm_base_url', config.baseUrl || 'https://api.openai.com/v1');
    localStorage.setItem('xml_llm_api_key', config.apiKey || '');
    localStorage.setItem('xml_system_prompt', config.systemPrompt || (window.DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT || ''));
    localStorage.setItem('xml_last_output', config.lastOutput || '');
}

function applyXmlConfig(config = {}) {
    const merged = {
        templatePrompt: localStorage.getItem('xml_template_prompt') || '',
        panelCount: parseInt(localStorage.getItem('xml_template_count') || getElementValue('xml-template-count', '30'), 10) || 30,
        reuseMainApi: localStorage.getItem('xml_reuse_api_cfg') !== 'false',
        provider: localStorage.getItem('xml_llm_provider') || 'openai',
        modelName: localStorage.getItem('xml_llm_model') || getElementValue('xml-llm-model', 'gpt-4o'),
        baseUrl: localStorage.getItem('xml_llm_base_url') || getElementValue('xml-llm-base-url', 'https://api.openai.com/v1'),
        apiKey: localStorage.getItem('xml_llm_api_key') || '',
        systemPrompt: localStorage.getItem('xml_system_prompt') || (window.DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT || ''),
        lastOutput: localStorage.getItem('xml_last_output') || '',
        ...config
    };

    if (!merged.systemPrompt || isLegacyXmlTemplatePrompt(merged.systemPrompt)) {
        merged.systemPrompt = window.DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT || '';
    }

    setElementValue('xml-template-prompt', merged.templatePrompt);
    setElementValue('xml-template-count', String(merged.panelCount || 30));
    setCheckboxValue('xml-reuse-api-cfg', merged.reuseMainApi !== false);
    setElementValue('xml-llm-provider', merged.provider);
    setElementValue('xml-llm-model', merged.modelName);
    setElementValue('xml-llm-base-url', merged.baseUrl);
    setElementValue('xml-llm-api-key', merged.apiKey);
    setElementValue('xml-system-prompt', merged.systemPrompt);
    setElementValue('xml-output-textarea', merged.lastOutput);
    const outputBlock = document.getElementById('xml-output-block');
    if (outputBlock && merged.lastOutput) outputBlock.classList.remove('hidden');
    syncXmlConfigToLocalStorage(merged);
    toggleXmlCustomApiPanel(false);
}

function saveXmlConfigFromDom() {
    syncXmlConfigToLocalStorage(getXmlConfigFromDom());
    saveConfigToComfyServer();
}

function getChatConfigFromState() {
    return {
        systemPrompt: localStorage.getItem(CHAT_SYSTEM_PROMPT_STORAGE_KEY) || getDefaultChatSystemPromptText(),
        windowLayout: parseLocalStorageJson(CHAT_FLOATING_WINDOW_LAYOUT_KEY, null),
        panelLayout: parseLocalStorageJson(CHAT_SYSTEM_PROMPT_PANEL_LAYOUT_KEY, null),
        sessions: Array.isArray(chatSessions) ? chatSessions : parseLocalStorageJson('comfy_comic_chat_sessions', []),
        activeSessionId: activeChatSessionId || localStorage.getItem('comfy_comic_active_chat_session_id') || null
    };
}

function applyChatConfig(config = {}) {
    if (!config || typeof config !== 'object') return;
    if (config.systemPrompt !== undefined) {
        localStorage.setItem(CHAT_SYSTEM_PROMPT_STORAGE_KEY, config.systemPrompt || '');
    }
    if (config.panelLayout) {
        writeLocalStorageJson(CHAT_SYSTEM_PROMPT_PANEL_LAYOUT_KEY, config.panelLayout);
    }
    if (config.windowLayout) {
        writeLocalStorageJson(CHAT_FLOATING_WINDOW_LAYOUT_KEY, config.windowLayout);
    }
    if (Array.isArray(config.sessions)) {
        chatSessions = config.sessions;
        chatSessionsInitialized = chatSessions.length > 0;
        writeLocalStorageJson('comfy_comic_chat_sessions', chatSessions);
    }
    if (config.activeSessionId) {
        activeChatSessionId = config.activeSessionId;
        localStorage.setItem('comfy_comic_active_chat_session_id', activeChatSessionId);
    }
}

function saveChatConfigFromState() {
    const config = getChatConfigFromState();
    if (config.activeSessionId) {
        localStorage.setItem('comfy_comic_active_chat_session_id', config.activeSessionId);
    }
    saveConfigToComfyServer();
}

function getUiConfigFromDom() {
    return {
        theme: getCurrentTheme(),
        selectedMatrixTemplateId: getElementValue('matrix-template-selector', localStorage.getItem('matrix_template_selector') || ''),
        selectedLlmRowId: getElementValue('llm-row-selector', localStorage.getItem('llm_row_selector') || ''),
        selectedLlmTemplateId: getElementValue('llm-template-selector', localStorage.getItem('llm_template_selector') || ''),
        globalStoryPrompt: getElementValue('global-story-prompt', localStorage.getItem('global_story_prompt') || '')
    };
}

function syncUiConfigToLocalStorage(config) {
    if (!config || typeof config !== 'object') return;
    if (config.theme) localStorage.setItem('theme', config.theme);
    localStorage.setItem('matrix_template_selector', config.selectedMatrixTemplateId || '');
    localStorage.setItem('llm_row_selector', config.selectedLlmRowId || '');
    localStorage.setItem('llm_template_selector', config.selectedLlmTemplateId || '');
    localStorage.setItem('global_story_prompt', config.globalStoryPrompt || '');
}

function applyUiConfig(config = {}) {
    const merged = {
        theme: localStorage.getItem('theme') || getCurrentTheme(),
        selectedMatrixTemplateId: localStorage.getItem('matrix_template_selector') || '',
        selectedLlmRowId: localStorage.getItem('llm_row_selector') || '',
        selectedLlmTemplateId: localStorage.getItem('llm_template_selector') || '',
        globalStoryPrompt: localStorage.getItem('global_story_prompt') || '',
        ...config
    };

    applyThemeConfig(merged.theme);
    setElementValue('global-story-prompt', merged.globalStoryPrompt);
    setSelectValueSafely('matrix-template-selector', merged.selectedMatrixTemplateId);
    setSelectValueSafely('llm-row-selector', merged.selectedLlmRowId);
    setSelectValueSafely('llm-template-selector', merged.selectedLlmTemplateId);
    syncUiConfigToLocalStorage(getUiConfigFromDom());
}

function saveUiConfigFromDom() {
    syncUiConfigToLocalStorage(getUiConfigFromDom());
    saveConfigToComfyServer();
}

function bindPersistentConfigInputs() {
    [
        'llm-provider',
        'llm-model-name',
        'llm-base-url',
        'llm-api-key',
        'llm-system-prompt',
        'llm-chunk-size'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.persistBound) {
            const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(eventName, saveLlmConfigFromDom);
            el.dataset.persistBound = 'true';
        }
    });

    ['comfy-url-input', 'engine-mock-toggle'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.persistBound) {
            const eventName = el.type === 'checkbox' ? 'change' : 'input';
            el.addEventListener(eventName, saveComfyConfigFromDom);
            el.dataset.persistBound = 'true';
        }
    });

    [
        'xml-template-prompt',
        'xml-system-prompt',
        'xml-template-count',
        'xml-reuse-api-cfg',
        'xml-llm-provider',
        'xml-llm-model',
        'xml-llm-base-url',
        'xml-llm-api-key'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.persistBound) {
            const eventName = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
            el.addEventListener(eventName, saveXmlConfigFromDom);
            el.dataset.persistBound = 'true';
        }
    });

    [
        'matrix-template-selector',
        'llm-row-selector',
        'llm-template-selector',
        'global-story-prompt'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.persistBound) {
            const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(eventName, saveUiConfigFromDom);
            el.dataset.persistBound = 'true';
        }
    });
}

function createEmptyBatchRunState() {
    return {
        status: 'idle',
        sessionId: null,
        tplId: '',
        templateTitle: '',
        activeBookId: null,
        currentBookTitle: '',
        progressPct: 0,
        progressLabel: '',
        logs: [],
        startedAt: 0,
        updatedAt: 0
    };
}

function normalizeBatchRunState(rawState) {
    const empty = createEmptyBatchRunState();
    if (!rawState || typeof rawState !== 'object') return empty;
    const normalized = {
        ...empty,
        ...rawState,
        logs: Array.isArray(rawState.logs) ? rawState.logs.slice(-300) : []
    };
    normalized.progressPct = Number.isFinite(Number(normalized.progressPct)) ? Math.max(0, Math.min(100, Number(normalized.progressPct))) : 0;
    return normalized;
}

function loadBatchRunStateFromStorage() {
    try {
        batchRunState = normalizeBatchRunState(JSON.parse(localStorage.getItem(BATCH_STATE_KEY) || 'null'));
    } catch (err) {
        console.warn('[BatchState] Failed to parse stored batch state:', err.message);
        batchRunState = createEmptyBatchRunState();
    }
}

function saveBatchRunStateToStorage(syncServer = false) {
    batchRunState = normalizeBatchRunState({
        ...batchRunState,
        updatedAt: Date.now()
    });
    localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(batchRunState));
    if (syncServer) {
        saveConfigToComfyServer();
    }
}

function setBatchRunState(status, extra = {}, syncServer = true) {
    batchRunState = normalizeBatchRunState({
        ...batchRunState,
        ...extra,
        status
    });
    saveBatchRunStateToStorage(syncServer);
    renderBatchConsoleFromState();
}

function setBatchProgress(percent, label) {
    const safePercent = Math.max(0, Math.min(100, Math.floor(percent || 0)));
    batchRunState.progressPct = safePercent;
    if (label !== undefined) batchRunState.progressLabel = label;

    const pctEl = document.getElementById('progress-pct');
    const barEl = document.getElementById('progress-bar-inner');
    const labelEl = document.getElementById('progress-lbl');
    if (pctEl) pctEl.innerText = `${safePercent}%`;
    if (barEl) barEl.style.width = `${safePercent}%`;
    if (labelEl && batchRunState.progressLabel) labelEl.innerText = batchRunState.progressLabel;

    saveBatchRunStateToStorage(true);
}

function renderBatchConsoleFromState() {
    const progressCard = document.getElementById('progress-card');
    const logger = document.getElementById('progress-logs');
    const pctEl = document.getElementById('progress-pct');
    const barEl = document.getElementById('progress-bar-inner');
    const labelEl = document.getElementById('progress-lbl');
    const runBtn = document.getElementById('btn-run-batch');
    const cancelBtn = document.getElementById('btn-cancel-batch');
    if (!progressCard || !logger) return;

    const status = batchRunState.status || 'idle';
    const shouldShow = status !== 'idle' && (
        (batchRunState.logs && batchRunState.logs.length > 0) ||
        batchRunState.progressPct > 0 ||
        status === 'active' ||
        status === 'stale'
    );

    if (shouldShow) {
        progressCard.classList.remove('hidden');
        logger.innerHTML = (batchRunState.logs || []).map(entry => {
            const colorClass = entry.colorClass || 'text-slate-400';
            return `<div class="${colorClass}">[${escapeHtml(entry.time || '')}] ${escapeHtml(entry.message || '')}</div>`;
        }).join('');
        logger.scrollTop = logger.scrollHeight;
    }

    if (pctEl) pctEl.innerText = `${batchRunState.progressPct || 0}%`;
    if (barEl) barEl.style.width = `${batchRunState.progressPct || 0}%`;
    if (labelEl && batchRunState.progressLabel) labelEl.innerText = batchRunState.progressLabel;

    const needsCancelControl = status === 'active' || status === 'stale';
    if (runBtn) runBtn.classList.toggle('hidden', needsCancelControl);
    if (cancelBtn) {
        cancelBtn.classList.toggle('hidden', !needsCancelControl);
        cancelBtn.classList.toggle('flex', needsCancelControl);
        cancelBtn.disabled = false;
    }
}

function reviveInterruptedBatchIfNeeded() {
    if (batchRunState.status === 'active' && batchRunState.sessionId !== BATCH_SESSION_ID) {
        batchRunState.status = 'stale';
        batchRunState.progressLabel = '页面刷新后，前端轮询已中断';
        batchRunState.logs = batchRunState.logs || [];
        batchRunState.logs.push({
            time: new Date().toLocaleTimeString(),
            message: '检测到页面刷新：前端已失去上一轮 ComfyUI 轮询。可点击“停止执行”向 ComfyUI 发送中断并清空等待队列。',
            colorClass: 'text-amber-400 font-bold'
        });
        batchRunState.logs = batchRunState.logs.slice(-300);
        saveBatchRunStateToStorage(true);
    }
    renderBatchConsoleFromState();
}

// Seed data for immediate play
const defaultTemplates = [
    {
        id: "tpl_daily",
        title: "都市奇遇：四幕日常",
        desc: "人物登场、跳舞、盛装华服再到安然入眠。极富律动与情绪变化的日常组图。",
        steps: [
            {
                name: "一幕：街头邂逅",
                prompt: "A beautiful raw photo of {character}, {style}, standing at a sunny busy city street corner, looking directly at the camera, wearing {outfit}, perfect anatomy, highly detailed, 8k resolution",
                caption: "在一个充满生机的清晨，{character} 悄然出现在繁华都市的街角，开启新的一天。"
            },
            {
                name: "二幕：街头起舞",
                prompt: "Action shot, {character}, {style}, dancing passionately, wind blowing hair, neon signs and glowing lights in the background, high dynamic action, emotion in eyes, wearing {outfit}",
                caption: "路旁音响飘扬起熟悉的旋律，伴着节奏，{character} 尽情起舞，释放无限青春活力。"
            },
            {
                name: "三幕：华服晚宴",
                prompt: "Cinematic portrait, {character}, {style}, wearing an elegant sparkling formal evening dress, performing an elegant classical dance under luxurious chandeliers, magical atmosphere, depth of field",
                caption: "华灯初上，换上奢华璀璨的夜礼服，在璀璨的水晶吊灯下起舞，流溢着梦幻般的美感。"
            },
            {
                name: "四幕：温馨晚安",
                prompt: "Cozy close-up shot, {character} sleeping soundly in a warm cozy bedroom bed, covered in a soft blanket, gentle moonlight through the window, peaceful, hyper-detailed, soft shadows",
                caption: "繁盛喧嚣散尽，带着满足的心绪和闪闪发光的梦境，进入甜蜜安宁的梦乡。"
            }
        ]
    },
    {
        id: "tpl_fantasy",
        title: "幻梦纪元：神兵觉醒",
        desc: "探索森林巨门、迎击魔能怪兽、手执圣剑立于孤峰，最终惬意露营的英雄冒险史诗。",
        steps: [
            {
                name: "一幕：发现秘境",
                prompt: "Epic fantasy concept art, {character}, {style}, standing before a giant mossy ancient stone portal deep in a magical glowing forest, holding a magic blue light crystal, mysterious scale",
                caption: "穿越重重迷雾，{character} 终于抵达那扇被岁月遗忘的远古巨石遗迹，开启了奇妙的探索之旅。"
            },
            {
                name: "二幕：魔能激斗",
                prompt: "Dynamic wide action scene, {character}, {style}, fighting a giant magical elemental shadow monster, casting a spell, glowing magical circle, glowing weapon, sparks flying, epic combat",
                caption: "守护魔能的怪兽咆哮而至，凝聚全身魔力，勇敢地迎向这排山倒海般的魔法对决！"
            },
            {
                name: "三幕：神兵铸就",
                prompt: "Majestic masterpiece, {character}, {style}, in shining silver-gold knight armor, standing on an epic mountain peak holding high a glowing legendary sword, sunset skies, clouds below, majestic",
                caption: "当圣剑发出绝伦清鸣，穿上神圣坚实的铠甲，登临孤高山巅，誓要守护身后的和平安乐。"
            },
            {
                name: "四幕：篝火营地",
                prompt: "Cozy warm close shot, {character}, {style}, sitting near a campfire under a starry sky, cooking soup, smiling, warm orange glowing light, peaceful adventurers camping atmosphere",
                caption: "激烈的冒险过后，围坐在璀璨星空下的篝火旁，一碗热气腾腾的小汤洗去一天的风霜。"
            }
        ]
    }
];

const defaultMatrixRows = [
    {
        id: "row_1",
        active: true,
        bookTitle: "红发少女初音的旅程",
        character: "a gorgeous 20-year-old girl with vibrant long red hair and green eyes",
        style: "anime illustration style, digital painting, vibrant colors",
        outfit: "a classic white jacket and denim shorts",
        captions: {}
    },
    {
        id: "row_2",
        active: true,
        bookTitle: "赛博朋克：霓虹守望者",
        character: "a cool mechanical-cybernetic detective with glowing blue neon eyes, white hair",
        style: "gritty cyberpunk style, futuristic, rain-slicked city streets, moody volumetric lighting",
        outfit: "a dark leather trenchcoat with yellow holographic patches",
        captions: {}
    }
];

// Seed galleries
const seedGalleries = [
    {
        id: "g_1",
        title: "星光誓言：红发少女的都市奇遇",
        characterName: "红发少女",
        templateTitle: "都市奇遇：四幕日常",
        synopsis: "讲述一位拥有热烈红发的异乡少女，在喧哗都市间起舞，最终找到自我与安宁的写照。",
        tags: ["都市日常", "红发少女", "动漫风", "连环画", "ComfyUI"],
        steps: [
            {
                name: "一幕：街头邂逅",
                prompt: "A beautiful raw photo of a gorgeous 20-year-old girl with vibrant long red hair and green eyes, anime illustration style, digital painting, vibrant colors, standing at a sunny busy city street corner, looking directly at the camera, wearing a classic white jacket and denim shorts, perfect anatomy, highly detailed, 8k resolution",
                caption: "在一个充满生机的清晨，红发少女悄然出现在繁华都市的街角，开启新的一天。",
                image: makeLocalArtPlaceholder("seed:一幕：街头邂逅")
            },
            {
                name: "二幕：街头起舞",
                prompt: "Action shot, a gorgeous 20-year-old girl with vibrant long red hair and green eyes, anime illustration style, digital painting, vibrant colors, dancing passionately, wind blowing hair, neon signs and glowing lights in the background, high dynamic action, emotion in eyes, wearing a classic white jacket and denim shorts",
                caption: "路旁音响飘扬起熟悉的旋律，伴着节奏，她情不自禁地随风起舞，吸引了路人的目光。",
                image: makeLocalArtPlaceholder("seed:二幕：街头起舞")
            },
            {
                name: "三幕：华服晚宴",
                prompt: "Cinematic portrait, a gorgeous 20-year-old girl with vibrant long red hair and green eyes, anime illustration style, digital painting, vibrant colors, wearing an elegant sparkling formal evening dress, performing an elegant classical dance under luxurious chandeliers, magical atmosphere, depth of field",
                caption: "夜幕降临，她换上了一身璀璨的晚礼服，在华丽的霓虹灯影中尽情倾诉。",
                image: makeLocalArtPlaceholder("seed:三幕：华服晚宴")
            },
            {
                name: "四幕：温馨晚安",
                prompt: "Cozy close-up shot, a gorgeous 20-year-old girl with vibrant long red hair and green eyes sleeping soundly in a warm cozy bedroom bed, covered in a soft blanket, gentle moonlight through the window, peaceful, hyper-detailed, soft shadows",
                caption: "繁盛喧嚣散尽，带着满足的心绪和闪闪发光的梦境，进入甜蜜安宁的梦乡。",
                image: makeLocalArtPlaceholder("seed:四幕：温馨晚安")
            }
        ]
    },
    {
        id: "g_2",
        title: "霓虹黑客：暗夜守望狂想曲",
        characterName: "赛博侦探",
        templateTitle: "都市奇遇：四幕日常",
        synopsis: "赛博朋克重镇中的冷酷机械义眼侦探，在霓虹街头追踪数据流、释放狂热灵魂并沉入虚拟世界温床的故事。",
        tags: ["赛博朋克", "机械义体", "超宽画幅", "暗黑重金属"],
        steps: [
            {
                name: "一幕：街头邂逅",
                prompt: "A beautiful raw photo of a cool mechanical-cybernetic detective with glowing blue neon eyes, white hair, gritty cyberpunk style, futuristic, rain-slicked city streets, moody volumetric lighting, standing at a sunny busy city street corner, looking directly at the camera, wearing a dark leather trenchcoat with yellow holographic patches, perfect anatomy, highly detailed, 8k resolution",
                caption: "酸雨洗刷过的赛博重城，冷漠的探员正站在终端塔边缘，检索着整座霓虹森林的异常波动。",
                image: makeLocalArtPlaceholder("seed:一幕：街头邂逅")
            },
            {
                name: "二幕：街头起舞",
                prompt: "Action shot, a cool mechanical-cybernetic detective with glowing blue neon eyes, white hair, gritty cyberpunk style, futuristic, rain-slicked city streets, moody volumetric lighting, dancing passionately, wind blowing hair, neon signs and glowing lights in the background, high dynamic action, emotion in eyes, wearing a dark leather trenchcoat with yellow holographic patches",
                caption: "为了对抗过载的心智，他在全息虚拟舞厅的节奏脉冲中释放重金属般的狂热重组。",
                image: makeLocalArtPlaceholder("seed:二幕：街头起舞")
            },
            {
                name: "三幕：华服晚宴",
                prompt: "Cinematic portrait, a cool mechanical-cybernetic detective with glowing blue neon eyes, white hair, gritty cyberpunk style, futuristic, rain-slicked city streets, moody volumetric lighting, wearing an elegant sparkling formal evening dress, performing an elegant classical dance under luxurious chandeliers, magical atmosphere, depth of field",
                caption: "换上一身剪裁得体、极具未来主义的西装，他游走在巨头晚宴与致命迷雾的核心交界点。",
                image: makeLocalArtPlaceholder("seed:三幕：华服晚宴")
            },
            {
                name: "四幕：温馨晚安",
                prompt: "Cozy close-up shot, a cool mechanical-cybernetic detective with glowing blue neon eyes, white hair sleeping soundly in a warm cozy bedroom bed, covered in a soft blanket, gentle moonlight through the window, peaceful, hyper-detailed, soft shadows",
                caption: "拔掉神经缆线，让超负荷的数据内核陷入纯粹的死循环冷却中。晚安，钢铁城市。",
                image: makeLocalArtPlaceholder("seed:四幕：温馨晚安")
            }
        ]
    }
];


// Initialize App
window.addEventListener('DOMContentLoaded', () => {
    appReadyPromise = loadLocalStorageData().then(() => {
        window.isAppInitializing = false;
        console.log('[Sync] App initialization finished. Server saving is now enabled.');
        if (shouldSaveAfterInitialization) {
            shouldSaveAfterInitialization = false;
            saveConfigToComfyServer();
        }
    });
    initLucide();
    renderTemplatesList();
    renderMatrixTable();
    populateTemplateDropdowns();
    renderGallery();
    renderBatchConsoleFromState();
    initChatFloatingWindow();
    initChatSystemPromptPanel();
    initChatInputEnhancements();
    initGlobalShortcuts();
    
    // Check comfy status periodically
    testComfyConnection(true);
});

function persistRunningBatchBeforePageExit() {
    const hasRecoverableBatch = runningBatch || batchRunState.status === 'active' || batchRunState.status === 'stale';
    if (!hasRecoverableBatch) return false;

    updateLastActiveTime();
    if (runningBatch) {
        batchRunState.status = 'active';
        batchRunState.sessionId = BATCH_SESSION_ID;
    }
    saveBatchRunStateToStorage(false);
    localStorage.setItem('comfy_comic_galleries', JSON.stringify(savedGalleries));
    saveConfigBeforePageExit();
    return true;
}

window.addEventListener('pagehide', () => {
    persistRunningBatchBeforePageExit();
});

window.addEventListener('beforeunload', (event) => {
    if (!runningBatch) return;
    persistRunningBatchBeforePageExit();
    event.preventDefault();
    event.returnValue = '';
});

// 图标库是纯装饰性依赖：即便 vendor/lucide.min.js 缺失或加载失败，
// 也绝不允许它把整个渲染管线（renderGallery / renderMatrixTable / DOMContentLoaded）打断。
let hasWarnedAboutMissingLucide = false;
function initLucide(rootElement = null) {
    if (typeof lucide === 'undefined' || typeof lucide.createIcons !== 'function') {
        if (!hasWarnedAboutMissingLucide) {
            hasWarnedAboutMissingLucide = true;
            console.warn('[UI] 图标库未加载，界面将以无图标模式继续运行。');
        }
        return;
    }
    try {
        if (rootElement) {
            lucide.createIcons({ root: rootElement });
        } else {
            lucide.createIcons();
        }
    } catch (err) {
        console.warn('[UI] 图标渲染失败，已跳过：', err.message);
    }
}

// Toggle Dark/Light Theme
function toggleTheme() {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    }
    saveUiConfigFromDom();
}

// Initialize memory variables with fallback defaults when cloud data is missing
function initMemoryStateWithDefaults() {
    templates = JSON.parse(JSON.stringify(defaultTemplates));
    activeTemplateId = templates[0]?.id || null;

    batchMatrix = {
        columns: DEFAULT_MATRIX_COLUMNS.slice(),
        rows: JSON.parse(JSON.stringify(defaultMatrixRows))
    };
    normalizeBatchMatrixState();

    savedGalleries = JSON.parse(JSON.stringify(seedGalleries));
    
    comfyWorkflows = [];
    activeWorkflowId = null;

    batchRunState = createEmptyBatchRunState();
}

// Master state initialization wrapper (Pure local server disk storage)
async function loadLocalStorageData() {
    isMockMode = localStorage.getItem('comfy_is_mock') === 'true';

    // 1. 尝试从 ComfyUI 后端服务器磁盘拉取最新落盘配置
    const loadedFromServer = await loadConfigFromComfyServer();
    if (!loadedFromServer) {
        // 如果服务器磁盘没有，强制用出厂默认初始化内存状态
        initMemoryStateWithDefaults();
        // 并且保存一份初始的到服务器
        await executeServerSave();
    }

    normalizeBatchMatrixState();
    localStorage.setItem('comfy_comic_matrix', JSON.stringify(batchMatrix));

    // 2. 绘制所有视图模块，保证完全同步状态
    renderTemplatesList();
    renderMatrixTable();
    populateTemplateDropdowns();
    renderGallery();
    renderWorkflowSelector();
    if (activeWorkflowId) {
        selectWorkflow(activeWorkflowId, false);
    }
    applyLlmConfig();
    applyXmlConfig();
    applyComfyConfig();
    renderEngineModeUi();
    applyUiConfig();
    bindPersistentConfigInputs();
    populateLlmStorySelector();
    renderLlmCaptionsList();

    // Bind Node ID text input events for persistence
    document.getElementById('node-id-positive').addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('node-select-positive').value = val;
        syncComfyConfigToLocalStorage(getComfyConfigFromDom());
        updateActiveWorkflowConfig('nodePositive', val);
        if (!activeWorkflowId) saveComfyConfigFromDom();
    });
    document.getElementById('node-id-negative').addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('node-select-negative').value = val;
        syncComfyConfigToLocalStorage(getComfyConfigFromDom());
        updateActiveWorkflowConfig('nodeNegative', val);
        if (!activeWorkflowId) saveComfyConfigFromDom();
    });
    document.getElementById('node-id-output').addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('node-select-output').value = val;
        syncComfyConfigToLocalStorage(getComfyConfigFromDom());
        updateActiveWorkflowConfig('nodeOutput', val);
        if (!activeWorkflowId) saveComfyConfigFromDom();
    });

    reviveInterruptedBatchIfNeeded();
    syncXmlSystemPromptInput();
}

function saveTemplatesToStorage(forceWrite = false) {
    updateLastActiveTime();
    localStorage.setItem('comfy_comic_templates', JSON.stringify(templates));
    saveConfigToComfyServer(forceWrite);
}

function saveMatrixToStorage() {
    updateLastActiveTime();
    localStorage.setItem('comfy_comic_matrix', JSON.stringify(batchMatrix));
    saveConfigToComfyServer();
}

function saveGalleriesToStorage(immediate = false, forceWrite = false) {
    updateLastActiveTime();
    localStorage.setItem('comfy_comic_galleries', JSON.stringify(savedGalleries));
    return immediate ? enqueueSaveTask(forceWrite) : saveConfigToComfyServer(forceWrite);
}


// Tab Controller
function switchTab(tabId) {
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.add('hidden');
    });
    document.getElementById(`tab-${tabId}`).classList.remove('hidden');

    // Reset navigation tab buttons visual state
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.className = "nav-tab px-4 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100";
    });

    const activeBtn = document.getElementById(`tab-btn-${tabId}`);
    if (activeBtn) {
        activeBtn.className = "nav-tab px-4 py-1.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 bg-white dark:bg-slate-700 text-blue-600 dark:text-white shadow-sm";
    }

    // Sync Mobile Navigation tabs visual state
    document.querySelectorAll('.mobile-nav-tab').forEach(btn => {
        btn.classList.remove('text-blue-500');
        btn.classList.add('text-slate-400');
    });
    const activeMobBtn = document.getElementById(`mobile-tab-btn-${tabId}`);
    if (activeMobBtn) {
        activeMobBtn.classList.remove('text-slate-400');
        activeMobBtn.classList.add('text-blue-500');
    }

    initLucide();
    if (tabId === 'llm') {
        populateLlmStorySelector();
        renderLlmCaptionsList();
    }
}
