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


// --- TAB 2: TEMPLATE EDITOR ---
// 只重画左侧模板库列表，不碰右侧编辑器 —— 自动保存过程中调用它才不会
// 在用户打字时重建 textarea、丢掉焦点和光标位置。
function renderTemplatesSidebar() {
    const container = document.getElementById('templates-list-container');
    if (!container) return;
    container.innerHTML = '';

    templates.forEach(t => {
        const isActive = t.id === activeTemplateId;
        const activeClasses = isActive 
            ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-l-4 border-blue-500 font-bold" 
            : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border-l-4 border-transparent";

        const tplCard = `
            <div onclick="selectTemplate(${inlineJsString(t.id)})" class="p-2.5 rounded-lg border-b border-slate-100 dark:border-slate-800/40 transition-all duration-150 cursor-pointer flex justify-between items-center ${activeClasses}">
                <span class="text-xs truncate w-40" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
                <span class="text-[9px] bg-slate-200/60 dark:bg-slate-800 text-slate-500 font-mono px-1.5 py-0.5 rounded shrink-0">${t.steps.length}P</span>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', tplCard);
    });
    initLucide(container);
}

function renderTemplatesList() {
    renderTemplatesSidebar();
    populateActiveTemplateSteps();
    bindTemplateEditorAutosave();
}

function selectTemplate(tplId) {
    if (!tplId || tplId === activeTemplateId) return;
    // 先把当前模板在 DOM 里的未保存编辑收回内存：否则 renderTemplatesList() 会用
    // 旧的内存状态重建编辑器，用户刚敲进去的分镜内容被静默丢弃且无法找回。
    syncDomToActiveTemplate();
    flushTemplateAutosave();
    activeTemplateId = tplId;
    saveTemplatesToStorage();
    renderTemplatesList();
    populateTemplateDropdowns();
}

// 模板编辑器改为“边改边存”：输入即回写内存并延迟落盘，
// 用户不必记得点“保存模板”也不会丢内容。
let templateAutosaveTimer = null;
function scheduleTemplateAutosave() {
    syncDomToActiveTemplate();
    if (templateAutosaveTimer) clearTimeout(templateAutosaveTimer);
    templateAutosaveTimer = setTimeout(() => {
        templateAutosaveTimer = null;
        saveTemplatesToStorage();
        renderTemplatesSidebar();
        populateTemplateDropdowns();
    }, 600);
}

function flushTemplateAutosave() {
    if (!templateAutosaveTimer) return;
    clearTimeout(templateAutosaveTimer);
    templateAutosaveTimer = null;
    saveTemplatesToStorage();
}

function bindTemplateEditorAutosave() {
    [
        document.getElementById('steps-editor-container'),
        document.getElementById('tpl-title-input'),
        document.getElementById('tpl-desc-input')
    ].forEach(el => {
        if (!el || el.dataset.autosaveBound) return;
        el.dataset.autosaveBound = 'true';
        el.addEventListener('input', scheduleTemplateAutosave);
    });
}

function createNewTemplate() {
    syncDomToActiveTemplate();
    flushTemplateAutosave();
    const newTpl = {
        id: "tpl_" + Date.now(),
        title: "未命名新连环画模板",
        desc: "在这里描述这个连环画的主线思路",
        steps: [
            {
                name: "第一幕：主角出现",
                prompt: "A beautiful close-up of {character}, {style}, standing looking directly at the camera, highly detailed",
                caption: "在这个美妙的时刻，{character} 悄然出现。"
            }
        ]
    };
    templates.unshift(newTpl);
    activeTemplateId = newTpl.id;
    saveTemplatesToStorage();
    renderTemplatesList();
    populateTemplateDropdowns();
}

function restoreDefaultTemplates() {
    flushTemplateAutosave();
    if (confirm("确定要恢复默认模板吗？这将覆盖您现有的模板。")) {
        templates = JSON.parse(JSON.stringify(defaultTemplates));
        activeTemplateId = templates[0].id;
        saveTemplatesToStorage(true);
        renderTemplatesList();
        populateTemplateDropdowns();
    }
}

function deleteCurrentTemplate() {
    flushTemplateAutosave();
    if (templates.length <= 1) {
        alert("抱歉，您至少要保留一个画册模板。");
        return;
    }
    if (confirm("确定要删除当前模板吗？此操作不可逆。")) {
        templates = templates.filter(t => t.id !== activeTemplateId);
        activeTemplateId = templates[0].id;
        saveTemplatesToStorage(true);
        renderTemplatesList();
        populateTemplateDropdowns();
    }
}

function saveCurrentTemplate() {
    if (templateAutosaveTimer) {
        clearTimeout(templateAutosaveTimer);
        templateAutosaveTimer = null;
    }
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return;

    // Collect header data
    t.title = document.getElementById('tpl-title-input').value;
    t.desc = document.getElementById('tpl-desc-input').value;

    // Collect step data
    const stepCards = document.querySelectorAll('.step-editor-card');
    const updatedSteps = [];

    stepCards.forEach(card => {
        const name = card.querySelector('.step-name').value;
        const prompt = card.querySelector('.step-prompt').value;
        const caption = card.querySelector('.step-caption').value;
        updatedSteps.push({ name, prompt, caption });
    });

    t.steps = updatedSteps;
    saveTemplatesToStorage();
    renderTemplatesList();
    populateTemplateDropdowns();
    alert("模板保存成功！🎉");
}

function populateActiveTemplateSteps() {
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return;

    document.getElementById('tpl-title-input').value = t.title;
    document.getElementById('tpl-desc-input').value = t.desc;

    const container = document.getElementById('steps-editor-container');
    container.innerHTML = '';

    t.steps.forEach((step, idx) => {
        const stepCard = `
            <div class="step-editor-card p-4 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 relative space-y-3">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-bold font-mono text-blue-500">分镜 ${String(idx + 1).padStart(2, '0')} / FRAME</span>
                    <button onclick="removeStepFromActive(${idx})" class="p-1 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition">
                        <i data-lucide="minus-circle" class="w-4 h-4"></i>
                    </button>
                </div>
                
                <div class="grid md:grid-cols-12 gap-3">
                    <div class="md:col-span-4 space-y-1">
                        <label class="block text-[10px] text-slate-400 font-bold">本幕主题 (例如：一幕 偶遇)</label>
                        <input type="text" class="step-name w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-xs focus:outline-none" value="${escapeHtml(step.name)}">
                    </div>
                    <div class="md:col-span-8 space-y-1">
                        <label class="block text-[10px] text-slate-400 font-bold">默认旁白文案（备用文案）</label>
                        <input type="text" class="step-caption w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-xs focus:outline-none" value="${escapeHtml(step.caption)}">
                    </div>
                </div>

                <div class="space-y-1">
                    <div class="flex justify-between items-center">
                        <label class="block text-[10px] text-slate-400 font-bold">ComfyUI 积极提示词模板</label>
                        <span class="text-[9px] text-indigo-400 font-mono">支持 {character}, {character1}, {character2}, {style}, {outfit} 等占位符</span>
                    </div>
                    <textarea rows="3" class="step-prompt w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 text-xs focus:outline-none font-mono leading-relaxed">${escapeHtml(step.prompt)}</textarea>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', stepCard);
    });
    initLucide();
}

// 将当前 DOM 里的编辑值同步回 templates 内存（防止 re-render 时覆盖用户未保存的编辑）
function syncDomToActiveTemplate() {
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return;

    // 同步标题和描述
    const titleEl = document.getElementById('tpl-title-input');
    const descEl  = document.getElementById('tpl-desc-input');
    if (titleEl) t.title = titleEl.value;
    if (descEl)  t.desc  = descEl.value;

    // 同步每个分镜卡片
    const cards = document.querySelectorAll('.step-editor-card');
    cards.forEach((card, idx) => {
        if (!t.steps[idx]) return;
        const nameEl    = card.querySelector('.step-name');
        const captionEl = card.querySelector('.step-caption');
        const promptEl  = card.querySelector('.step-prompt');
        if (nameEl)    t.steps[idx].name    = nameEl.value;
        if (captionEl) t.steps[idx].caption = captionEl.value;
        if (promptEl)  t.steps[idx].prompt  = promptEl.value;
    });
}

function addNewStepToActive() {
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return;

    syncDomToActiveTemplate(); // 先把当前 DOM 编辑内容同步回内存

    t.steps.push({
        name: `第 ${t.steps.length + 1} 幕：分镜设定`,
        prompt: "{character}, {style}, in another epic pose, highly detailed",
        caption: "画面一转，{character} 面向未来露出微笑。"
    });

    populateActiveTemplateSteps();
}

function removeStepFromActive(idx) {
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return;

    if (t.steps.length <= 1) {
        alert("您至少必须保留一个故事分镜！");
        return;
    }

    syncDomToActiveTemplate(); // 先把当前 DOM 编辑内容同步回内存
    t.steps.splice(idx, 1);
    populateActiveTemplateSteps();
}



// --- TAB 3: BATCH MATRIX ---
function renderMatrixTable() {
    normalizeBatchMatrixState();
    renderMatrixTableHeader();

    const tbody = document.getElementById('matrix-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    document.getElementById('matrix-stats-lbl').innerText = `${batchMatrix.rows.length} 组角色已就绪`;

    batchMatrix.rows.forEach((row, rIdx) => {
        let columnsHtml = '';
        
        batchMatrix.columns.forEach(col => {
            const cellVal = row[col] || '';
            columnsHtml += `
                <td class="p-3">
                    <textarea oninput="updateMatrixCellValue(${rIdx}, '${col}', this.value)" rows="2" class="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 rounded-lg p-1.5 focus:outline-none text-[11px] leading-normal select-text" placeholder="输入 {${escapeHtml(col)}} 的替换内容">${escapeHtml(cellVal)}</textarea>
                </td>
            `;
        });

        const rowHtml = `
            <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition text-slate-700 dark:text-slate-300">
                <td class="p-3 text-center">
                    <input type="checkbox" ${row.active ? 'checked' : ''} onchange="toggleMatrixRowActive(${rIdx}, this.checked)" class="w-4 h-4 rounded text-blue-500 accent-blue-500 focus:ring-0 bg-gray-100 border-gray-300">
                </td>
                <td class="p-3">
                    <input type="text" value="${escapeHtml(row.bookTitle || '')}" oninput="updateMatrixCellValue(${rIdx}, 'bookTitle', this.value)" class="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 rounded-lg p-1.5 focus:outline-none text-[11px] font-bold" placeholder="起个亮眼的标题">
                </td>
                ${columnsHtml}
                <td class="p-3 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick="openScriptModal(${inlineJsString(row.id)})" class="p-1.5 rounded hover:bg-purple-500/10 text-slate-400 hover:text-purple-500 transition" title="手动审阅/编辑本组剧本旁白">
                            <i data-lucide="scroll" class="w-4 h-4"></i>
                        </button>
                        <button onclick="deleteMatrixRow(${rIdx})" class="p-1.5 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition" title="删除该行">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
        tbody.insertAdjacentHTML('beforeend', rowHtml);
    });
    initLucide();
    populateLlmRowSelector();
}

function updateMatrixCellValue(rIdx, colName, value) {
    normalizeBatchMatrixState();
    if (!batchMatrix.rows[rIdx]) return;
    batchMatrix.rows[rIdx][colName] = value;
    saveMatrixToStorage();
}

function toggleMatrixRowActive(rIdx, isChecked) {
    batchMatrix.rows[rIdx].active = isChecked;
    saveMatrixToStorage();
}

function addMatrixRow() {
    normalizeBatchMatrixState();
    const newRow = {
        id: "row_" + Date.now(),
        active: true,
        bookTitle: "新探索故事",
        captions: {}
    };
    batchMatrix.columns.forEach(col => {
        newRow[col] = "";
    });
    batchMatrix.rows.push(newRow);
    saveMatrixToStorage();
    renderMatrixTable();
}

function deleteMatrixRow(rIdx) {
    batchMatrix.rows.splice(rIdx, 1);
    saveMatrixToStorage();
    renderMatrixTable();
}

function addCustomVariableColumn() {
    const varName = prompt("请输入自定义占位符名称（不需要写花括号）：\n例如 character1、character2、outfit。若输入 {character1}，系统也会自动识别。");
    if (!varName) return;

    const sanitized = sanitizeMatrixVariableName(varName);
    if (!sanitized) {
        alert("无效的变量名称。请使用字母、数字或下划线。");
        return;
    }

    normalizeBatchMatrixState();

    if (batchMatrix.columns.includes(sanitized) || MATRIX_RESERVED_FIELDS.has(sanitized)) {
        alert("该字段名称已存在或属于保留字段。");
        return;
    }

    batchMatrix.columns.push(sanitized);
    batchMatrix.rows.forEach(row => {
        row[sanitized] = row[sanitized] || '';
    });

    saveMatrixToStorage();
    renderMatrixTable();
}

function populateTemplateDropdowns() {
    const sel = document.getElementById('matrix-template-selector');
    if (sel) {
        sel.innerHTML = '';
        templates.forEach(t => {
            sel.insertAdjacentHTML('beforeend', `
                <option value="${escapeHtml(t.id)}">${escapeHtml(t.title)} (${t.steps.length} 幕)</option>
            `);
        });
    }

    const llmSel = document.getElementById('llm-template-selector');
    if (llmSel) {
        llmSel.innerHTML = '';
        templates.forEach(t => {
            llmSel.insertAdjacentHTML('beforeend', `
                <option value="${escapeHtml(t.id)}">${escapeHtml(t.title)} (${t.steps.length} 幕)</option>
            `);
        });
    }

    populateLlmRowSelector();
}


// --- TAB 4: WORKFLOW HELPERS ---
function saveWorkflowsToStorage(forceWrite = false) {
    updateLastActiveTime();
    localStorage.setItem('comfy_workflows', JSON.stringify(comfyWorkflows));
    localStorage.setItem('comfy_active_workflow_id', activeWorkflowId);
    saveConfigToComfyServer(forceWrite);
}

function renderWorkflowSelector() {
    const selector = document.getElementById('workflow-selector');
    if (!selector) return;
    selector.innerHTML = '';
    if (comfyWorkflows.length === 0) {
        selector.innerHTML = '<option value="">-- 暂无工作流，请在下方上传 --</option>';
        return;
    }
    comfyWorkflows.forEach(wf => {
        const isSelected = wf.id === activeWorkflowId ? 'selected' : '';
        selector.insertAdjacentHTML('beforeend', `
            <option value="${escapeHtml(wf.id)}" ${isSelected}>${escapeHtml(wf.name)}</option>
        `);
    });
}

function selectWorkflow(wfId, updateInputs = true) {
    if (!wfId) {
        activeWorkflowId = null;
        document.getElementById('node-select-positive').innerHTML = '<option value="">-- 请上传工作流或手动输入 --</option>';
        document.getElementById('node-select-negative').innerHTML = '<option value="">-- 请上传工作流或手动输入 --</option>';
        document.getElementById('node-select-output').innerHTML = '<option value="">-- 请上传工作流或手动输入 --</option>';
        document.getElementById('node-id-positive').value = '';
        document.getElementById('node-id-negative').value = '';
        document.getElementById('node-id-output').value = '';
        comfyWorkflowRaw = null;
        if (updateInputs) saveWorkflowsToStorage();
        return;
    }
    const wf = comfyWorkflows.find(w => w.id === wfId);
    if (!wf) return;

    activeWorkflowId = wfId;
    comfyWorkflowRaw = wf.raw;
    if (updateInputs) saveWorkflowsToStorage();

    const selector = document.getElementById('workflow-selector');
    if (selector) selector.value = wfId;

    parseAndPopulateWorkflowDropdowns(wf.raw);

    if (updateInputs) {
        document.getElementById('node-id-positive').value = wf.nodePositive || '';
        document.getElementById('node-id-negative').value = wf.nodeNegative || '';
        document.getElementById('node-id-output').value = wf.nodeOutput || '';
        
        document.getElementById('node-select-positive').value = wf.nodePositive || '';
        document.getElementById('node-select-negative').value = wf.nodeNegative || '';
        document.getElementById('node-select-output').value = wf.nodeOutput || '';
    } else {
        document.getElementById('node-id-positive').value = wf.nodePositive || '';
        document.getElementById('node-id-negative').value = wf.nodeNegative || '';
        document.getElementById('node-id-output').value = wf.nodeOutput || '';
        
        setTimeout(() => {
            document.getElementById('node-select-positive').value = wf.nodePositive || '';
            document.getElementById('node-select-negative').value = wf.nodeNegative || '';
            document.getElementById('node-select-output').value = wf.nodeOutput || '';
        }, 100);
    }
}

function updateActiveWorkflowConfig(key, value) {
    if (!activeWorkflowId) return;
    const wf = comfyWorkflows.find(w => w.id === activeWorkflowId);
    if (wf) {
        wf[key] = value;
        saveWorkflowsToStorage();
    }
}

function renameWorkflow() {
    if (!activeWorkflowId) {
        alert("请先上传或选择一个工作流！");
        return;
    }
    const wf = comfyWorkflows.find(w => w.id === activeWorkflowId);
    if (!wf) return;
    
    const newName = prompt("请输入工作流的新名称：", wf.name);
    if (newName && newName.trim()) {
        wf.name = newName.trim();
        saveWorkflowsToStorage();
        renderWorkflowSelector();
        initLucide();
    }
}

function deleteWorkflow() {
    if (!activeWorkflowId) {
        alert("请先选择要删除的工作流！");
        return;
    }
    const wf = comfyWorkflows.find(w => w.id === activeWorkflowId);
    if (!wf) return;
    
    if (confirm(`确定要删除工作流「${wf.name}」吗？`)) {
        comfyWorkflows = comfyWorkflows.filter(w => w.id !== activeWorkflowId);
        if (comfyWorkflows.length > 0) {
            activeWorkflowId = comfyWorkflows[0].id;
        } else {
            activeWorkflowId = null;
        }
        saveWorkflowsToStorage(true);
        renderWorkflowSelector();
        selectWorkflow(activeWorkflowId, true);
        initLucide();
    }
}

function handleWorkflowUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const parsed = JSON.parse(evt.target.result);
            const wfName = file.name.replace(/\.[^/.]+$/, "");
            const newId = "wf_" + Date.now();
            
            const newWf = {
                id: newId,
                name: wfName,
                raw: parsed,
                nodePositive: '6',
                nodeNegative: '',
                nodeOutput: '9'
            };
            
            comfyWorkflows.push(newWf);
            activeWorkflowId = newId;
            
            saveWorkflowsToStorage();
            renderWorkflowSelector();
            selectWorkflow(newId, true);
            initLucide();
            
            alert("ComfyUI 工作流成功导入！已添加到列表并自动切换为当前活动配置。🎉");
        } catch (err) {
            alert("解析工作流 JSON 失败，请确保格式正确且不为常规网页工作流。错误: " + err.message);
        }
        e.target.value = '';
    };
    reader.readAsText(file);
}

function parseAndPopulateWorkflowDropdowns(workflow) {
    const posSel = document.getElementById('node-select-positive');
    const negSel = document.getElementById('node-select-negative');
    const outSel = document.getElementById('node-select-output');

    posSel.innerHTML = '<option value="">-- 手动在下方填写节点ID --</option>';
    negSel.innerHTML = '<option value="">-- 手动在下方填写节点ID (可选) --</option>';
    outSel.innerHTML = '<option value="">-- 手动在下方填写节点ID --</option>';

    Object.keys(workflow).forEach(nodeId => {
        const node = workflow[nodeId];
        const type = node.class_type || '';
        
        let displayName = `节点 [${nodeId}] - ${type}`;
        if (node._meta?.title) displayName += ` (${node._meta.title})`;

        if (type.includes('CLIPTextEncode') || type.includes('CLIPText') || type.includes('Text')) {
            posSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(nodeId)}">${escapeHtml(displayName)}</option>`);
            negSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(nodeId)}">${escapeHtml(displayName)}</option>`);
        }

        if (type.includes('Save') || type.includes('Preview') || type.includes('Image') || type.includes('Output')) {
            outSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(nodeId)}">${escapeHtml(displayName)}</option>`);
        }
    });

    posSel.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('node-id-positive').value = val;
        syncComfyConfigToLocalStorage(getComfyConfigFromDom());
        updateActiveWorkflowConfig('nodePositive', val);
        if (!activeWorkflowId) saveComfyConfigFromDom();
    });
    negSel.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('node-id-negative').value = val;
        syncComfyConfigToLocalStorage(getComfyConfigFromDom());
        updateActiveWorkflowConfig('nodeNegative', val);
        if (!activeWorkflowId) saveComfyConfigFromDom();
    });
    outSel.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('node-id-output').value = val;
        syncComfyConfigToLocalStorage(getComfyConfigFromDom());
        updateActiveWorkflowConfig('nodeOutput', val);
        if (!activeWorkflowId) saveComfyConfigFromDom();
    });
}


// --- TAB 3: DECOUPLED NARRATIVE GENERATOR ---
function addLog(msg, colorClass = "text-slate-400") {
    const logger = document.getElementById('progress-logs');
    if (!logger) return;
    const now = new Date().toLocaleTimeString();
    logger.insertAdjacentHTML('beforeend', `
        <div class="${colorClass}">[${escapeHtml(now)}] ${escapeHtml(msg)}</div>
    `);
    logger.scrollTop = logger.scrollHeight;

    batchRunState.logs = batchRunState.logs || [];
    batchRunState.logs.push({
        time: now,
        message: String(msg),
        colorClass
    });
    batchRunState.logs = batchRunState.logs.slice(-300);
    saveBatchRunStateToStorage(true);
}

// Generate script captions for all selected matrix rows (pure LLM phase with chunk size support)
async function generateAllSelectedScripts() {
    const activeRows = batchMatrix.rows.filter(r => r.active);
    if (activeRows.length === 0) {
        alert("请在角色矩阵表格中勾选并启用至少一行角色。");
        return;
    }
    
    const tplId = document.getElementById('matrix-template-selector').value;
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) {
        alert("所选模板不存在！");
        return;
    }
    
    const llmKey = document.getElementById('llm-api-key').value.trim();
    if (!llmKey && !isMockMode) {
        alert("请先在【设置】面板配置大模型 API Key！或者在右侧勾选“模拟模式”体验离线流程。");
        return;
    }
    
    // Switch on logs console
    document.getElementById('progress-card').classList.remove('hidden');
    document.getElementById('progress-logs').innerHTML = '';
    
    const chunkSize = parseInt(document.getElementById('llm-chunk-size').value) || 4;
    addLog(`🧠 [LLM 剧本生成] 流水线开启。共有 ${activeRows.length} 个角色组，分段大小: ${chunkSize} 幕，模板: ${tpl.title}`, "text-blue-400 font-bold");
    
    for (let i = 0; i < activeRows.length; i++) {
        if (cancelRequested) break;
        const row = activeRows[i];
        addLog(`----------------------------------------`);
        addLog(`🎬 正在生成角色【${row.bookTitle}】的剧本旁白文字...`, "text-indigo-400");
        
        const preparedPanels = tpl.steps.map((step, idx) => {
            const finalPrompt = replaceTemplatePlaceholders(step.prompt, row);
            const finalCaption = replaceTemplatePlaceholders(step.caption, row);
            return {
                name: step.name,
                prompt: finalPrompt,
                fallbackCaption: finalCaption
            };
        });

        let captions = [];
        try {
            // 分批次调用大模型进行剧情连贯性接龙生成
            for (let chunkIdx = 0; chunkIdx < preparedPanels.length; chunkIdx += chunkSize) {
                if (cancelRequested) break;
                
                const chunk = preparedPanels.slice(chunkIdx, chunkIdx + chunkSize);
                const stepRangeText = `${chunkIdx + 1} - ${Math.min(chunkIdx + chunkSize, preparedPanels.length)}`;
                addLog(`⚙️ 正在向大模型分批请求分镜 [${stepRangeText}] 幕旁白剧情...`);
                
                let chunkCaptions = [];
                if (!isMockMode) {
                    const globalOutlineEl = document.getElementById('global-story-prompt');
                    const globalOutline = globalOutlineEl ? globalOutlineEl.value.trim() : '';
                    chunkCaptions = await requestLlmChunkCaptions(globalOutline, chunk, row.bookTitle, chunkIdx, captions);
                } else {
                    await sleep(600);
                    chunkCaptions = chunk.map((p, idx) => simulateLlmStoryline(row.bookTitle, p.name, chunkIdx + idx));
                }
                
                captions = captions.concat(chunkCaptions);
            }
            
            if (cancelRequested) break;
            
            const storyVersion = createStoryVersion(row, tplId, tpl, captions, {
                source: 'llm',
                prefix: 'LLM剧情'
            });
            saveMatrixToStorage();
            
            addLog(`✅ 角色【${row.bookTitle}】剧本已保存为「${storyVersion?.title || '新剧情'}」！`, "text-emerald-400");
        } catch (err) {
            addLog(`❌ 剧本生成失败: ${err.message}`, "text-red-500 font-bold");
        }
    }
    
    if (cancelRequested) {
        addLog(`🛑 剧本生成队列已被手动中止。`, "text-red-500 font-bold");
    } else {
        addLog(`🎉 恭喜，所选角色的剧本已全部生成入库！点击列表里的“📜”图标可进行人工编辑和精修。`, "text-emerald-400 font-bold");
        alert("剧本旁白批量生成成功！");
    }
    cancelRequested = false;
}

// --- SCRIPT EDITOR MODAL CONTROLLERS ---
let editingRowId = null;
let editingStoryVersionId = null;

function openScriptModal(rowId) {
    editingRowId = rowId;
    const row = batchMatrix.rows.find(r => r.id === rowId);
    if (!row) return;

    const tplId = document.getElementById('matrix-template-selector').value;
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) {
        alert("请先选择一个连环画模板。");
        return;
    }

    const fallbackCaptions = tpl.steps.map(step => replaceTemplatePlaceholders(step.caption, row));
    const storyVersion = ensureEditableStoryVersion(row, tplId, tpl, {
        fallbackCaptions,
        source: 'manual',
        prefix: '默认剧情'
    });
    editingStoryVersionId = storyVersion?.id || null;
    saveMatrixToStorage();

    document.getElementById('script-modal-title').innerText = `${row.bookTitle} (${tpl.title} / ${storyVersion?.title || '当前剧情'})`;
    const container = document.getElementById('script-editor-container');
    container.innerHTML = '';

    const currentCaptions = storyVersion?.captions || [];

    tpl.steps.forEach((step, idx) => {
        const val = currentCaptions[idx] || "";
        const itemHtml = `
            <div class="space-y-1.5 p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-slate-500 dark:text-slate-400">${escapeHtml(step.name)}</span>
                </div>
                <textarea rows="2" class="script-textarea w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-xs focus:outline-none" data-idx="${idx}">${escapeHtml(val)}</textarea>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', itemHtml);
    });

    const modal = document.getElementById('script-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    initLucide();
}

function closeScriptModal() {
    const modal = document.getElementById('script-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    editingRowId = null;
    editingStoryVersionId = null;
}

function saveAndCloseScriptModal() {
    if (!editingRowId) return;
    const row = batchMatrix.rows.find(r => r.id === editingRowId);
    if (!row) return;

    const tplId = document.getElementById('matrix-template-selector').value;
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;
    const textareas = document.querySelectorAll('.script-textarea');
    
    const captionsArray = [];
    textareas.forEach(ta => {
        const idx = parseInt(ta.getAttribute('data-idx'));
        captionsArray[idx] = ta.value;
    });

    if (editingStoryVersionId) {
        setActiveStoryVersion(row, tplId, editingStoryVersionId);
    }
    updateStoryVersionCaptions(row, tplId, tpl, captionsArray, {
        source: 'manual'
    });
    saveMatrixToStorage();
    closeScriptModal();
    alert("剧本旁白已保存！");
}

async function generateScriptForCurrentRow() {
    if (!editingRowId) return;
    const row = batchMatrix.rows.find(r => r.id === editingRowId);
    if (!row) return;

    const tplId = document.getElementById('matrix-template-selector').value;
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;

    const llmKey = document.getElementById('llm-api-key').value.trim();
    if (!llmKey && !isMockMode) {
        alert("请配置大模型 API Key 密钥再继续！");
        return;
    }

    const btn = document.querySelector("#script-modal button[onclick='generateScriptForCurrentRow()']");
    const origText = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> 生成中...`;
    initLucide();
    btn.disabled = true;

    try {
        const preparedPanels = tpl.steps.map((step, idx) => {
            const finalPrompt = replaceTemplatePlaceholders(step.prompt, row);
            const finalCaption = replaceTemplatePlaceholders(step.caption, row);
            return {
                name: step.name,
                prompt: finalPrompt,
                fallbackCaption: finalCaption
            };
        });

        let captions = [];
        if (!isMockMode) {
            const globalOutlineEl = document.getElementById('global-story-prompt');
            const globalOutline = globalOutlineEl ? globalOutlineEl.value.trim() : '';
            captions = await requestLlmAllCaptions(globalOutline, preparedPanels, row.bookTitle);
        } else {
            await sleep(1000);
            captions = preparedPanels.map((p, idx) => simulateLlmStoryline(row.bookTitle, p.name, idx));
        }

        const storyVersion = createStoryVersion(row, tplId, tpl, captions, {
            source: 'llm',
            prefix: 'LLM剧情'
        });
        editingStoryVersionId = storyVersion?.id || null;
        saveMatrixToStorage();

        const textareas = document.querySelectorAll('.script-textarea');
        textareas.forEach(ta => {
            const idx = parseInt(ta.getAttribute('data-idx'));
            ta.value = captions[idx] || "";
        });
        document.getElementById('script-modal-title').innerText = `${row.bookTitle} (${tpl.title} / ${storyVersion?.title || '新剧情'})`;

        alert("AI 剧本已生成，并作为新剧情版本保存！");
    } catch(err) {
        alert("剧本生成出错: " + err.message);
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
        initLucide();
    }
}


// --- TAB 3: DECOUPLED IMAGE DRAWING PIPELINE ---
async function cancelBatchGeneration() {
    const canControlPersistedRun = batchRunState.status === 'active' || batchRunState.status === 'stale';
    if (!runningBatch && !canControlPersistedRun) return;

    cancelRequested = true;
    const cancelBtn = document.getElementById('btn-cancel-batch');
    if (cancelBtn) cancelBtn.disabled = true;

    addLog("收到用户终止指令，正在物理打断 ComfyUI 生图并取消后续队列...", "text-red-400 font-bold");
    await interruptComfy();

    if (!runningBatch) {
        addLog("已向 ComfyUI 发送中断和清队列请求。当前浏览器中没有可继续轮询的活动任务。", "text-amber-400 font-bold");
        setBatchRunState('canceled', {
            progressLabel: '已发送中断请求',
            sessionId: BATCH_SESSION_ID
        }, true);
    } else if (cancelBtn) {
        cancelBtn.disabled = false;
    }
}

async function startBatchGeneration() {
    if (runningBatch) return;

    await appReadyPromise.catch(err => {
        console.warn('[Init] Previous state synchronization failed before starting batch:', err.message);
    });

    saveMatrixToStorage();

    const tplId = document.getElementById('matrix-template-selector').value;
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) {
        alert("所选模板不存在！");
        return;
    }

    const activeRows = batchMatrix.rows.filter(r => r.active);
    if (activeRows.length === 0) {
        alert("当前没有勾选启用的角色。请在表格左侧勾选至少一行。");
        return;
    }

    if (!isMockMode) {
        const posNodeId = document.getElementById('node-id-positive').value.trim();
        const outNodeId = document.getElementById('node-id-output').value.trim();
        if (!posNodeId || !outNodeId) {
            alert("生产模式下，必须指定积极提示词节点和图像输出节点ID！请前往【工作流设置】进行配置。");
            return;
        }
        if (!comfyWorkflowRaw) {
            alert("生产模式下，必须上传 ComfyUI 导出的 API JSON 工作流文件！");
            return;
        }
    }

    runningBatch = true;
    cancelRequested = false;
    document.getElementById('progress-card').classList.remove('hidden');
    document.getElementById('btn-run-batch').classList.add('hidden');
    document.getElementById('btn-cancel-batch').classList.remove('hidden');
    document.getElementById('btn-cancel-batch').classList.add('flex');
    document.getElementById('btn-cancel-batch').disabled = false;
    document.getElementById('progress-logs').innerHTML = '';

    batchRunState = createEmptyBatchRunState();
    setBatchRunState('active', {
        sessionId: BATCH_SESSION_ID,
        tplId,
        templateTitle: tpl.title,
        progressPct: 0,
        progressLabel: `准备生成 ${activeRows.length} 套故事`,
        logs: [],
        startedAt: Date.now()
    }, true);

    addLog(`⚡ [ComfyUI 图片绘制] 流水线启动！共有 ${activeRows.length} 套角色，模板：${tpl.title}`, "text-blue-400 font-bold");

    let currentBookIndex = 0;
    const totalBooks = activeRows.length;
    const totalStepsInTpl = tpl.steps.length;
    const grandTotalSubmissions = totalBooks * totalStepsInTpl;
    let currentFinishedSubmission = 0;
    let currentBook = null;

    try {
        for (let i = 0; i < activeRows.length; i++) {
            if (cancelRequested) {
                throw new BatchCancelError("User requested cancellation.");
            }
            const row = activeRows[i];
            currentBookIndex++;

            const bookTitle = row.bookTitle;
            
            addLog(`----------------------------------------`);
            addLog(`🎬 开始绘制第 ${currentBookIndex}/${totalBooks} 本画册：【${bookTitle}】`, "text-indigo-400 font-bold");

            const characterLabel = getPrimaryCharacterLabel(row);
            const activeStoryVersion = getActiveStoryVersion(row, tplId);
            const storyCaptions = activeStoryVersion ? activeStoryVersion.captions : getActiveStoryCaptions(row, tplId);
            const storyTitle = activeStoryVersion?.title || '模板默认剧情';
            const newBook = {
                id: "book_" + Date.now() + "_" + i,
                title: bookTitle || `探索画册_${i}`,
                characterName: characterLabel ? characterLabel.substring(0, 10) + "..." : "未命名角色",
                rowId: row.id,
                rowTitle: row.bookTitle || '',
                templateId: tplId,
                templateTitle: tpl.title,
                storyVersionId: activeStoryVersion?.id || '',
                storyTitle,
                synopsis: (document.getElementById('global-story-prompt') ? document.getElementById('global-story-prompt').value : null) || `利用公式《${tpl.title}》创作而成的精美组图。`,
                tags: ["AI连连看", "ComfyUI", "批量绘图"],
                totalSteps: tpl.steps.length,
                generatedSteps: 0,
                inProgress: true,
                status: "generating",
                createdAt: Date.now(),
                steps: []
            };
            currentBook = newBook;
            savedGalleries.unshift(newBook);
            await saveGalleriesToStorage(true);
            renderGallery();
            setBatchRunState('active', {
                activeBookId: newBook.id,
                currentBookTitle: newBook.title,
                progressLabel: `正在生成第 ${currentBookIndex}/${totalBooks} 套故事`
            }, true);

            // Prepare final prompts with variables
            const preparedPanels = tpl.steps.map((step, idx) => {
                const finalPrompt = replaceTemplatePlaceholders(step.prompt, row);
                const finalCaption = replaceTemplatePlaceholders(step.caption, row);
                return {
                    name: step.name,
                    prompt: finalPrompt,
                    fallbackCaption: finalCaption
                };
            });

            // Step sequence loop
            for (let j = 0; j < tpl.steps.length; j++) {
                if (cancelRequested) {
                    throw new BatchCancelError("User requested cancellation.");
                }

                const panelData = preparedPanels[j];
                addLog(`📍 正在渲染分镜 [${panelData.name}]...`);

                // Get cached script text (完全解耦大模型网络请求)
                let generatedStoryLine = "";
                if (storyCaptions && storyCaptions[j]) {
                    generatedStoryLine = storyCaptions[j];
                    addLog(`📖 加载预设的旁白: "${generatedStoryLine.substring(0, 15)}..."`, "text-slate-500");
                } else {
                    generatedStoryLine = panelData.fallbackCaption;
                    addLog(`📖 使用模板默认旁白: "${generatedStoryLine.substring(0, 15)}..."`, "text-slate-500");
                }

                // Call ComfyUI for image
                let renderedImgUrl = "";
                if (!isMockMode) {
                    addLog(`⚡ 向 ComfyUI 发送绘制任务，等待渲染队列...`);
                    try {
                        renderedImgUrl = await submitToRealComfy(panelData.prompt);
                        addLog(`✅ 图像接收下载完成！`, "text-emerald-500");
                    } catch (err) {
                        // 若抛出的是主动取消错误，或者取消信号已被激活，不进行占位降级，直接重抛阻断程序
                        if (err instanceof BatchCancelError || err.name === 'BatchCancelError' || cancelRequested) {
                            throw new BatchCancelError("User requested cancellation.");
                        }
                        addLog(`❌ ComfyUI 生成图片错误: ${err.message}`, "text-red-500 font-bold");
                        addLog(`已启用纯本地 SVG 矢量图进行安全降级容错。`);
                        renderedImgUrl = OFFLINE_PLACEHOLDER_IMAGE;
                    }
                } else {
                    addLog(`⚡ [模拟生图中] ComfyUI 接收节点并启动 KSampler...`);
                    await sleep(1500);
                    if (cancelRequested) {
                        throw new BatchCancelError("User requested cancellation.");
                    }
                    renderedImgUrl = getMockVisual(row.style, j, panelData.name);
                    addLog(`✅ [模拟成功] 图像已接收！`, "text-emerald-500");
                }

                newBook.steps.push({
                    stepIndex: j,
                    name: panelData.name,
                    prompt: panelData.prompt,
                    caption: generatedStoryLine,
                    image: renderedImgUrl
                });
                newBook.generatedSteps = newBook.steps.length;
                newBook.updatedAt = Date.now();
                saveGalleriesToStorage();
                renderGallery();

                currentFinishedSubmission++;
                const percent = Math.floor((currentFinishedSubmission / grandTotalSubmissions) * 100);
                setBatchProgress(percent, `正在生成第 ${currentBookIndex}/${totalBooks} 套故事`);
            }

            newBook.inProgress = false;
            newBook.status = "complete";
            newBook.generatedSteps = newBook.steps.length;
            newBook.completedAt = Date.now();
            saveGalleriesToStorage();
            renderGallery();
        }

        addLog(`🎉 恭喜！批量图片绘制已圆满完成！前往【画廊展厅】即可品味画册成品。`, "text-emerald-400 font-bold");
        setBatchRunState('completed', {
            activeBookId: null,
            currentBookTitle: '',
            progressPct: 100,
            progressLabel: '全部画册生成完成'
        }, true);
        alert("批量图片绘制成功！");
        switchTab('gallery');

    } catch (err) {
        if (err instanceof BatchCancelError || err.name === 'BatchCancelError') {
            if (currentBook) {
                currentBook.inProgress = false;
                currentBook.status = "canceled";
                currentBook.generatedSteps = currentBook.steps.length;
                currentBook.updatedAt = Date.now();
                saveGalleriesToStorage();
                renderGallery();
            }
            addLog(`🛑 绘图任务已被手动物理终止。已保留当前画册中已经生成的 ${currentBook?.steps?.length || 0} 张图片。`, "text-red-500 font-bold");
            setBatchRunState('canceled', {
                progressLabel: '任务已停止，已保留已生成图片',
                activeBookId: currentBook?.id || null,
                currentBookTitle: currentBook?.title || ''
            }, true);
        } else {
            if (currentBook) {
                currentBook.inProgress = false;
                currentBook.status = "failed";
                currentBook.generatedSteps = currentBook.steps.length;
                currentBook.updatedAt = Date.now();
                saveGalleriesToStorage();
                renderGallery();
            }
            addLog(`❌ 批量绘制过程中发生致命错误崩溃: ${err.message}`, "text-red-500 font-bold");
            setBatchRunState('failed', {
                progressLabel: '任务失败，已保留已生成图片',
                activeBookId: currentBook?.id || null,
                currentBookTitle: currentBook?.title || ''
            }, true);
            alert(`批量绘制失败: ${err.message}`);
        }
    } finally {
        // 使用 finally 确保所有锁与 UI 控件百分之百在任何退出情况下正确解锁，防止重入卡死
        runningBatch = false;
        cancelRequested = false;
        document.getElementById('btn-run-batch').classList.remove('hidden');
        document.getElementById('btn-cancel-batch').classList.add('hidden');
        document.getElementById('btn-cancel-batch').classList.remove('flex');
        document.getElementById('btn-cancel-batch').disabled = false;
    }
}

// Collapsible templates sidebar manager
let isSidebarCollapsed = false;
function toggleTemplatesSidebar() {
    const sidebar = document.getElementById('templates-sidebar-container');
    const editor = document.getElementById('templates-editor-container');
    const btnIcon = document.getElementById('toggle-sidebar-icon');
    
    isSidebarCollapsed = !isSidebarCollapsed;
    if (isSidebarCollapsed) {
        sidebar.classList.add('hidden');
        editor.className = "lg:col-span-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6 transition-all duration-300";
        if (btnIcon) btnIcon.setAttribute('data-lucide', 'chevrons-right');
    } else {
        sidebar.classList.remove('hidden');
        sidebar.className = "lg:col-span-3 space-y-4 transition-all duration-300";
        editor.className = "lg:col-span-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6 transition-all duration-300";
        if (btnIcon) btnIcon.setAttribute('data-lucide', 'chevrons-left');
    }
    initLucide();
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

// ============================================================================
// 💾 LOCAL DISK BACKEND STORAGE & MULTI-BROWSER BACKUP SYNC LOGIC (100% PERSISTENT)
// ============================================================================

// Push state payload to local Python backend server to write to disk comfy_comic_data.json
// Global Write Queue and Debounce control
let saveQueuePromise = Promise.resolve();
let saveDebounceTimeout = null;
let saveDebouncePromise = null;
let resolveDebouncedSave = null;
let destructiveSaveRevision = 0;
let persistedDestructiveSaveRevision = 0;

// Helper to update local updated timestamp
function updateLastActiveTime() {
    const now = Date.now();
    localStorage.setItem('comfy_comic_updated_at', now.toString());
    return now;
}

function getBackendConfigUrl() {
    return getLocalBackendUrl('/api/config');
}

function buildAppStatePayload(forceWrite = false) {
    return {
        templates: templates,
        activeTemplateId: activeTemplateId,
        batchMatrix: batchMatrix,
        savedGalleries: savedGalleries,
        comfyWorkflows: comfyWorkflows,
        activeWorkflowId: activeWorkflowId,
        comfyConfig: getComfyConfigFromDom(),
        llmConfig: getLlmConfigFromDom(),
        xmlConfig: getXmlConfigFromDom(),
        chatConfig: getChatConfigFromState(),
        uiConfig: getUiConfigFromDom(),
        batchRunState: batchRunState,
        xmlSystemPrompt: document.getElementById('xml-system-prompt')?.value || '',
        nodePositive: document.getElementById('node-id-positive')?.value || '6',
        nodeNegative: document.getElementById('node-id-negative')?.value || '',
        nodeOutput: document.getElementById('node-id-output')?.value || '9',
        updatedAt: Date.now(),
        forceWrite
    };
}

function saveConfigBeforePageExit() {
    const backendUrl = getBackendConfigUrl();
    const forceWrite = destructiveSaveRevision > persistedDestructiveSaveRevision;
    const payload = JSON.stringify(buildAppStatePayload(forceWrite));

    try {
        if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            if (navigator.sendBeacon(backendUrl, blob)) return true;
        }
    } catch (err) {
        console.warn('[Sync] sendBeacon save failed:', err.message);
    }

    try {
        fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        }).catch(err => console.warn('[Sync] keepalive save failed:', err.message));
        return true;
    } catch (err) {
        console.warn('[Sync] keepalive save setup failed:', err.message);
        return false;
    }
}

// Push state payload to local Python backend server to write to disk comfy_comic_data.json
function saveConfigToComfyServer(forceWrite = false) {
    if (window.isAppInitializing) {
        console.debug('[Sync] Deferred save request during app initialization.');
        return Promise.resolve();
    }
    if (forceWrite) destructiveSaveRevision += 1;
    // 每次开始调用，确保本地时间戳已同步更新
    updateLastActiveTime();

    if (saveDebounceTimeout) {
        clearTimeout(saveDebounceTimeout);
    }

    if (!saveDebouncePromise) {
        saveDebouncePromise = new Promise((resolve) => {
            resolveDebouncedSave = resolve;
        });
    }

    const pendingPromise = saveDebouncePromise;
    saveDebounceTimeout = setTimeout(async () => {
        const resolveCurrentSave = resolveDebouncedSave;
        saveDebounceTimeout = null;
        saveDebouncePromise = null;
        resolveDebouncedSave = null;
        await enqueueSaveTask();
        if (resolveCurrentSave) resolveCurrentSave();
    }, 500); // 500ms Debounce
    return pendingPromise;
}

// Queue actual network saves to prevent multi-request packet out-of-order execution
async function enqueueSaveTask(forceWrite = false) {
    if (forceWrite) destructiveSaveRevision += 1;
    saveQueuePromise = saveQueuePromise.then(async () => {
        await executeServerSave();
    }).catch(err => {
        console.error('[Sync] Queue execution encountered error: ', err);
    });
    return saveQueuePromise;
}

// Internal server saving executor
async function executeServerSave() {
    const backendUrl = getBackendConfigUrl();

    const syncStatusEl = document.getElementById('cloud-sync-status');
    if (syncStatusEl) {
        syncStatusEl.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin text-blue-500"></i> <span class="text-xs text-slate-400">正在保存到本地...</span>`;
        initLucide(syncStatusEl);
    }

    const capturedDestructiveRevision = destructiveSaveRevision;
    const forceWrite = capturedDestructiveRevision > persistedDestructiveSaveRevision;
    const appState = buildAppStatePayload(forceWrite);

    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(appState)
        });

        if (response.ok) {
            if (forceWrite) {
                persistedDestructiveSaveRevision = Math.max(
                    persistedDestructiveSaveRevision,
                    capturedDestructiveRevision
                );
            }
            console.log('[Sync] Disk backup persistent success.');
            if (syncStatusEl) {
                syncStatusEl.innerHTML = `<i data-lucide="hard-drive-download" class="w-3.5 h-3.5 text-emerald-500"></i> <span class="text-xs text-slate-400">已保存到本地</span>`;
                initLucide(syncStatusEl);
                setTimeout(() => { syncStatusEl.innerHTML = ''; }, 2000);
            }
        } else {
            console.warn('[Sync] Server rejected save: ', response.statusText);
            if (syncStatusEl) {
                syncStatusEl.innerHTML = `<i data-lucide="cloud-off" class="w-3.5 h-3.5 text-red-500"></i> <span class="text-xs text-slate-400">保存受阻</span>`;
                initLucide(syncStatusEl);
            }
        }
    } catch (err) {
        console.warn('[Sync] Local server offline. Fallback to LocalStorage.', err.message);
        if (syncStatusEl) {
            syncStatusEl.innerHTML = `<i data-lucide="cloud-off" class="w-3.5 h-3.5 text-slate-400"></i> <span class="text-xs text-slate-400">本地离线运行</span>`;
            initLucide(syncStatusEl);
            setTimeout(() => { syncStatusEl.innerHTML = ''; }, 2000);
        }
    }
}

function isRecoverableLocalGalleryBook(book, activeBookId = null) {
    if (!book || typeof book !== 'object') return false;
    return !!(
        book.inProgress ||
        book.status === 'generating' ||
        (activeBookId && book.id === activeBookId)
    );
}

function getBookGeneratedStepCount(book) {
    return Array.isArray(book?.steps) ? book.steps.length : 0;
}

function shouldPreferLocalRecoverableBook(localBook, serverBook) {
    if (!serverBook) return true;
    if (!isRecoverableLocalGalleryBook(localBook)) return false;

    const localUpdatedAt = Number(localBook.updatedAt || localBook.createdAt || 0);
    const serverUpdatedAt = Number(serverBook.updatedAt || serverBook.createdAt || 0);
    if (localUpdatedAt > serverUpdatedAt) return true;

    return getBookGeneratedStepCount(localBook) > getBookGeneratedStepCount(serverBook);
}

function mergeRecoverableLocalGalleries(serverGalleries, localGalleries, localBatchState) {
    const merged = Array.isArray(serverGalleries) ? serverGalleries.slice() : [];
    const localList = Array.isArray(localGalleries) ? localGalleries : [];
    const activeBookId = localBatchState?.activeBookId || null;
    let restoredCount = 0;

    localList.slice().reverse().forEach(localBook => {
        if (!isRecoverableLocalGalleryBook(localBook, activeBookId)) return;

        const existingIndex = merged.findIndex(book => book?.id === localBook.id);
        if (existingIndex === -1) {
            merged.unshift(localBook);
            restoredCount++;
            return;
        }

        if (shouldPreferLocalRecoverableBook(localBook, merged[existingIndex])) {
            merged[existingIndex] = localBook;
            restoredCount++;
        }
    });

    return { galleries: merged, restoredCount };
}

function chooseBatchRunState(serverState, localState) {
    const normalizedServer = normalizeBatchRunState(serverState);
    const normalizedLocal = normalizeBatchRunState(localState);
    const localIsRecoverable = normalizedLocal.status === 'active' || normalizedLocal.status === 'stale';
    const localIsNewer = Number(normalizedLocal.updatedAt || 0) > Number(normalizedServer.updatedAt || 0);

    if (localIsRecoverable && localIsNewer) {
        return normalizedLocal;
    }

    return normalizedServer;
}

// Pull config state from local Python backend server data JSON file and synchronize
async function loadConfigFromComfyServer() {
    const backendUrl = getBackendConfigUrl();
    const localSavedGalleries = parseLocalStorageJson('comfy_comic_galleries', []);
    const localBatchRunState = parseLocalStorageJson(BATCH_STATE_KEY, null);
    
    const syncStatusEl = document.getElementById('cloud-sync-status');
    if (syncStatusEl) {
        syncStatusEl.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin text-blue-500"></i> <span class="text-xs text-slate-400">正在读取本地配置...</span>`;
        initLucide(syncStatusEl);
    }

    try {
        const response = await fetch(backendUrl);
        if (!response.ok) {
            throw new Error(`Config file not found on local backend: ${response.status}`);
        }
        
        const appState = await response.json();
        if (!appState || Object.keys(appState).length === 0) {
            if (syncStatusEl) syncStatusEl.innerHTML = '';
            return false;
        }

        const serverUpdatedAt = parseInt(appState.updatedAt || '0');

        if (appState) {
            if (appState.templates) {
                templates = appState.templates;
                localStorage.setItem('comfy_comic_templates', JSON.stringify(templates));
            }
            if (appState.activeTemplateId) {
                activeTemplateId = appState.activeTemplateId;
            } else if (!activeTemplateId && templates.length > 0) {
                activeTemplateId = templates[0].id;
            }
            if (appState.batchMatrix) {
                batchMatrix = appState.batchMatrix;
                localStorage.setItem('comfy_comic_matrix', JSON.stringify(batchMatrix));
            }
            if (appState.savedGalleries) {
                const recovered = mergeRecoverableLocalGalleries(
                    appState.savedGalleries,
                    localSavedGalleries,
                    localBatchRunState
                );
                savedGalleries = recovered.galleries;
                if (recovered.restoredCount > 0) {
                    console.warn(`[Sync] Restored ${recovered.restoredCount} in-progress gallery book(s) from LocalStorage.`);
                    shouldSaveAfterInitialization = true;
                }
                // 历史遗留：把所有指向外网图床的分镜图迁移成本地矢量占位图
                let migratedRemoteImages = 0;
                savedGalleries.forEach(book => {
                    if (book.steps) {
                        book.steps.forEach(step => {
                            // 历史数据里残留的外网图床地址一律迁移为本地占位图，避免断网时破图。
                            if (typeof step.image === 'string' && /^https?:\/\/images\.unsplash\.com\//i.test(step.image)) {
                                step.image = makeLocalArtPlaceholder(`${book.id}:${step.name || ''}`, step.name || '');
                                migratedRemoteImages++;
                            }
                        });
                    }
                });
                if (migratedRemoteImages > 0) {
                    console.warn(`[Sync] 已把 ${migratedRemoteImages} 张外网图床分镜图迁移为本地占位图。`);
                    shouldSaveAfterInitialization = true;
                }
                localStorage.setItem('comfy_comic_galleries', JSON.stringify(savedGalleries));
            }
            if (appState.comfyWorkflows) {
                comfyWorkflows = appState.comfyWorkflows;
                localStorage.setItem('comfy_workflows', JSON.stringify(comfyWorkflows));
            }
            if (appState.activeWorkflowId) {
                activeWorkflowId = appState.activeWorkflowId;
                localStorage.setItem('comfy_active_workflow_id', activeWorkflowId);
            }
            if (appState.batchRunState) {
                const serverBatchRunState = normalizeBatchRunState(appState.batchRunState);
                batchRunState = chooseBatchRunState(serverBatchRunState, localBatchRunState);
                if (batchRunState !== serverBatchRunState) {
                    shouldSaveAfterInitialization = true;
                }
                localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(batchRunState));
            } else if (localBatchRunState) {
                batchRunState = normalizeBatchRunState(localBatchRunState);
                localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(batchRunState));
            }
            if (appState.comfyConfig) {
                syncComfyConfigToLocalStorage(appState.comfyConfig);
            }
            if (appState.llmConfig) {
                syncLlmConfigToLocalStorage(appState.llmConfig);
            }
            if (appState.xmlConfig) {
                syncXmlConfigToLocalStorage(appState.xmlConfig);
            }
            if (appState.chatConfig) {
                applyChatConfig(appState.chatConfig);
            }
            if (appState.uiConfig) {
                syncUiConfigToLocalStorage(appState.uiConfig);
            }
            if (Object.prototype.hasOwnProperty.call(appState, 'xmlSystemPrompt')) {
                localStorage.setItem('xml_system_prompt', appState.xmlSystemPrompt || '');
                const xmlSystemPromptInput = document.getElementById('xml-system-prompt');
                if (xmlSystemPromptInput) {
                    xmlSystemPromptInput.value = appState.xmlSystemPrompt || (window.DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT || '');
                }
            }
            if (appState.nodePositive) localStorage.setItem('comfy_node_positive', appState.nodePositive);
            if (Object.prototype.hasOwnProperty.call(appState, 'nodeNegative')) localStorage.setItem('comfy_node_negative', appState.nodeNegative || '');
            if (appState.nodeOutput) localStorage.setItem('comfy_node_output', appState.nodeOutput);
            
            // 将服务器拉取来的最新时间戳写入本地作为同步基线
            localStorage.setItem('comfy_comic_updated_at', serverUpdatedAt.toString());

            console.log('[LocalServer] Master state configuration loaded from local disk successfully!');
            
            if (syncStatusEl) {
                syncStatusEl.innerHTML = `<i data-lucide="hard-drive-download" class="w-3.5 h-3.5 text-emerald-500"></i> <span class="text-xs text-slate-400">已加载本地配置</span>`;
                initLucide(syncStatusEl);
                setTimeout(() => { syncStatusEl.innerHTML = ''; }, 2000);
            }
            return true;
        }
    } catch (err) {
        console.log('[LocalServer] Could not load state from local disk. Using LocalStorage.', err.message);
        if (syncStatusEl) syncStatusEl.innerHTML = '';
    }
    return false;
}

// --- TAB 5: LLM ENGINE & TEMPLATE GENERATION FUNCTIONS ---

// Collapsible control
function toggleSection(sectionId, arrowId) {
    const section = document.getElementById(sectionId);
    const arrow = document.getElementById(arrowId);
    if (!section) return;
    
    if (section.classList.contains('hidden')) {
        section.classList.remove('hidden');
        if (arrow) arrow.style.transform = 'rotate(0deg)';
    } else {
        section.classList.add('hidden');
        if (arrow) arrow.style.transform = 'rotate(-180deg)';
    }
}

// Provider Change Helper
function onLlmProviderChange() {
    const provider = document.getElementById('llm-provider').value;
    const urlInput = document.getElementById('llm-base-url');
    const modelInput = document.getElementById('llm-model-name');
    
    localStorage.setItem('llm_provider', provider);
    
    if (provider === 'openai') {
        urlInput.value = 'https://api.openai.com/v1';
        modelInput.value = 'gpt-4o';
    } else if (provider === 'deepseek') {
        urlInput.value = 'https://api.deepseek.com/v1';
        modelInput.value = 'deepseek-chat';
    }
    localStorage.setItem('llm_base_url', urlInput.value);
    localStorage.setItem('llm_model_name', modelInput.value);
    saveLlmConfigFromDom();
}

async function testLlmConnection() {
    saveLlmConfigFromDom();
    const config = getLlmConfigFromDom();
    if (!config.apiKey) {
        alert("请先填写 LLM API Key。");
        return;
    }

    try {
        const res = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.modelName,
                messages: [
                    { role: 'system', content: 'You are a connection test endpoint.' },
                    { role: 'user', content: 'Reply with OK.' }
                ],
                max_tokens: 8,
                temperature: 0
            })
        });

        if (!res.ok) {
            let message = `HTTP ${res.status}`;
            try {
                const errData = await res.json();
                message = errData.error?.message || message;
            } catch (e) {}
            throw new Error(message);
        }
        alert("LLM 服务连接成功，配置已落盘。");
    } catch (err) {
        alert(`LLM 服务连接失败：${err.message}`);
    }
}

function saveXmlSystemPromptConfig() {
    saveXmlConfigFromDom();
}

function restoreDefaultXmlSystemPrompt() {
    setElementValue('xml-system-prompt', window.DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT || '');
    saveXmlConfigFromDom();
}

function toggleXmlCustomApiPanel(persist = true) {
    const reuseMain = getCheckboxValue('xml-reuse-api-cfg', true);
    const panel = document.getElementById('xml-custom-api-panel');
    if (panel) {
        panel.classList.toggle('hidden', reuseMain);
    }
    if (persist) saveXmlConfigFromDom();
}

function getXmlRuntimeApiConfig() {
    const xmlConfig = getXmlConfigFromDom();
    if (xmlConfig.reuseMainApi !== false) {
        const llmConfig = getLlmConfigFromDom();
        return {
            provider: llmConfig.provider,
            apiKey: llmConfig.apiKey,
            modelName: llmConfig.modelName,
            baseUrl: llmConfig.baseUrl,
            systemPrompt: xmlConfig.systemPrompt
        };
    }
    return xmlConfig;
}

async function generateXmlTemplateWithLlm() {
    saveXmlConfigFromDom();
    const xmlConfig = getXmlConfigFromDom();
    const apiConfig = getXmlRuntimeApiConfig();
    const idea = xmlConfig.templatePrompt.trim();
    const panelCount = xmlConfig.panelCount || 30;
    if (!idea) {
        alert("请先填写题材大纲要求描述。");
        return;
    }
    if (!apiConfig.apiKey) {
        alert("请先配置可用的 API Key。");
        return;
    }

    const btn = document.getElementById('btn-xml-gen');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> 正在生成 XML...`;
        initLucide(btn);
    }

    try {
        const xmlText = await requestXmlTemplateFromLlm(
            idea,
            panelCount,
            apiConfig.provider,
            apiConfig.apiKey,
            apiConfig.modelName,
            apiConfig.baseUrl,
            apiConfig.systemPrompt
        );
        setElementValue('xml-output-textarea', xmlText);
        const outputBlock = document.getElementById('xml-output-block');
        if (outputBlock) outputBlock.classList.remove('hidden');
        saveXmlConfigFromDom();
    } catch (err) {
        alert(`XML 模板生成失败：${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            initLucide(btn);
        }
    }
}

function getDirectChildText(parent, tagName) {
    if (!parent) return '';
    const child = Array.from(parent.children).find(el => el.tagName === tagName);
    return child ? child.textContent.trim() : '';
}

function parseXmlTemplateText(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
        throw new Error("XML 格式解析失败，请检查模型输出。");
    }

    const root = doc.getElementsByTagName('模板')[0] || doc.documentElement;
    const title = getDirectChildText(root, '标题') || `AI XML 模板 ${new Date().toLocaleString()}`;
    const desc = getDirectChildText(root, '简介') || getDirectChildText(root, '描述') || '';
    const list = root.getElementsByTagName('分镜列表')[0] || root;
    const frameNodes = Array.from(list.children).filter(el => /^分镜\d*$/.test(el.tagName));
    if (frameNodes.length === 0) {
        throw new Error("XML 中没有找到 <分镜1>、<分镜2> 这类分镜节点。");
    }

    const steps = frameNodes.map((node, idx) => ({
        name: getDirectChildText(node, '名称') || `第 ${idx + 1} 幕`,
        prompt: getDirectChildText(node, '提示词'),
        caption: getDirectChildText(node, '剧情') || getDirectChildText(node, '台词')
    }));

    if (steps.some(step => !step.prompt)) {
        throw new Error("部分分镜缺少 <提示词> 内容。");
    }

    return {
        id: `tpl_xml_${Date.now()}`,
        title,
        desc,
        steps
    };
}

function saveXmlAsSystemTemplate() {
    const xmlText = getElementValue('xml-output-textarea', '').trim();
    if (!xmlText) {
        alert("还没有可保存的 XML 内容。");
        return;
    }

    try {
        const tpl = parseXmlTemplateText(xmlText);
        templates.unshift(tpl);
        activeTemplateId = tpl.id;
        saveTemplatesToStorage();
        renderTemplatesList();
        populateTemplateDropdowns();
        alert(`已保存模板「${tpl.title}」，共 ${tpl.steps.length} 幕。`);
    } catch (err) {
        alert(`保存 XML 模板失败：${err.message}`);
    }
}

// Populate LLM Matrix Row dropdown
function populateLlmRowSelector() {
    const rowSel = document.getElementById('llm-row-selector');
    if (!rowSel) return;
    rowSel.innerHTML = '';
    
    const activeRows = batchMatrix.rows.filter(r => r.active);
    if (activeRows.length === 0) {
        rowSel.innerHTML = '<option value="">-- 请先在批量角色矩阵中启用至少一行角色 --</option>';
        return;
    }
    activeRows.forEach(r => {
        rowSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(r.id)}">${escapeHtml(r.bookTitle)}</option>`);
    });
    
    rowSel.onchange = onLlmRowChange;
    populateLlmStorySelector();
}

// Render dynamic captions list
function onLlmRowChange() {
    populateLlmStorySelector();
    renderLlmCaptionsList();
    saveUiConfigFromDom();
}

function onLlmTemplateChange() {
    populateLlmStorySelector();
    renderLlmCaptionsList();
    saveUiConfigFromDom();
}

function populateLlmStorySelector(preferredStoryId = '') {
    const storySel = document.getElementById('llm-story-selector');
    if (!storySel) return;

    const rowId = document.getElementById('llm-row-selector')?.value || '';
    const tplId = document.getElementById('llm-template-selector')?.value || '';
    storySel.innerHTML = '';

    const row = batchMatrix.rows.find(r => r.id === rowId);
    const tpl = templates.find(t => t.id === tplId);
    if (!row || !tpl) {
        storySel.innerHTML = '<option value="">-- 请先选择角色和模板 --</option>';
        storySel.disabled = true;
        return;
    }

    const versions = getStoryVersions(row, tplId);
    if (versions.length === 0) {
        storySel.innerHTML = '<option value="">-- 尚未保存剧情 --</option>';
        storySel.disabled = true;
        return;
    }

    storySel.disabled = false;
    const activeVersion = preferredStoryId
        ? (setActiveStoryVersion(row, tplId, preferredStoryId) || getActiveStoryVersion(row, tplId))
        : getActiveStoryVersion(row, tplId);

    versions.forEach((version, idx) => {
        const filledCount = version.captions.filter(text => String(text || '').trim()).length;
        const title = version.title || `剧情 ${idx + 1}`;
        storySel.insertAdjacentHTML('beforeend', `
            <option value="${escapeHtml(version.id)}">${escapeHtml(title)} · ${filledCount}/${tpl.steps.length} 幕</option>
        `);
    });

    if (activeVersion) storySel.value = activeVersion.id;
}

function onLlmStoryChange() {
    const storySel = document.getElementById('llm-story-selector');
    const rowId = document.getElementById('llm-row-selector')?.value || '';
    const tplId = document.getElementById('llm-template-selector')?.value || '';
    const row = batchMatrix.rows.find(r => r.id === rowId);
    if (!row || !tplId || !storySel?.value) return;

    setActiveStoryVersion(row, tplId, storySel.value);
    saveMatrixToStorage();
    renderLlmCaptionsList();
}

function createNewLlmStoryVersion(copyCurrent = false) {
    const rowId = document.getElementById('llm-row-selector')?.value || '';
    const tplId = document.getElementById('llm-template-selector')?.value || '';
    const row = batchMatrix.rows.find(r => r.id === rowId);
    const tpl = templates.find(t => t.id === tplId);

    if (!row || !tpl) {
        alert("请先选择角色和模板。");
        return;
    }

    const captions = copyCurrent ? getActiveStoryCaptions(row, tplId).slice() : [];
    const version = createStoryVersion(row, tplId, tpl, captions, {
        source: copyCurrent ? 'duplicate' : 'manual',
        prefix: copyCurrent ? '剧情副本' : '新剧情'
    });

    saveMatrixToStorage();
    populateLlmStorySelector(version?.id || '');
    renderLlmCaptionsList();
    addLlmLog(copyCurrent ? "已复制当前剧情为新版本。" : "已新建空白剧情版本。", "text-slate-400");
}

function renderLlmCaptionsList() {
    const listContainer = document.getElementById('llm-vertical-captions-list');
    if (!listContainer) return;
    
    const rowId = document.getElementById('llm-row-selector').value;
    const tplId = document.getElementById('llm-template-selector').value;
    
    if (!rowId || !tplId) {
        listContainer.innerHTML = `<p class="text-xs text-slate-500 text-center py-6">请先选择角色和模板，然后点击上方一键生成，或直接在此编写剧情内容。</p>`;
        return;
    }
    
    const row = batchMatrix.rows.find(r => r.id === rowId);
    const tpl = templates.find(t => t.id === tplId);
    
    if (!row || !tpl) {
        listContainer.innerHTML = `<p class="text-xs text-red-500 text-center py-6">选择的模板或角色配置在系统中不存在。</p>`;
        return;
    }
    
    // 采用数组收集，最后一次性修改 innerHTML，避免多次 insertAdjacentHTML 导致频繁 Layout
    const cardsHtmlArray = [];
    
    const activeVersion = getActiveStoryVersion(row, tplId);
    const activeCaptions = activeVersion ? activeVersion.captions : getActiveStoryCaptions(row, tplId);
    
    tpl.steps.forEach((step, idx) => {
        let currentText = activeCaptions[idx];
        if (currentText === undefined) {
            currentText = ''; 
        }
        
        const resolvedPrompt = replaceTemplatePlaceholders(step.prompt, row);
        
        const cardHtml = `
            <div class="llm-story-card bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-slate-800 dark:text-slate-300">
                        【第 ${idx + 1} 幕 · ${escapeHtml(step.name)}】
                    </span>
                    <button data-single-story-btn="${idx}" onclick="generateSingleStoryline(${idx}, this)" class="px-2.5 py-1 text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-purple-600 dark:hover:bg-purple-600 hover:text-white dark:hover:text-white rounded border border-slate-200 dark:border-slate-700 transition flex items-center gap-1">
                        <i data-lucide="refresh-cw" class="w-3 h-3 text-purple-500"></i>
                        <span>单独生成/补发该幕</span>
                    </button>
                </div>
                
                <div class="text-[10px] text-slate-400 font-mono bg-slate-100 dark:bg-slate-900/60 p-2 rounded border border-slate-200 dark:border-slate-800 leading-normal break-all select-text">
                    <span class="font-bold text-slate-500">画面提示词：</span>${escapeHtml(resolvedPrompt)}
                </div>
                
                <div class="space-y-1">
                    <label class="block text-[10px] text-slate-400 font-bold">本子剧情台词：</label>
                    <textarea oninput="updateLlmCaption(${idx}, this.value)" id="llm-caption-text-${idx}" rows="2" class="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-xs focus:outline-none text-slate-800 dark:text-slate-200 focus:border-purple-500 transition leading-normal" placeholder="请输入本幕剧本台词或等待 AI 生成...">${escapeHtml(currentText)}</textarea>
                </div>
            </div>
        `;
        cardsHtmlArray.push(cardHtml);
    });
    
    listContainer.innerHTML = cardsHtmlArray.join('');
    // 仅针对卡片列表局部初始化 Lucide 图标，避免引发全局重排
    initLucide(listContainer);
}

function updateLlmCaption(stepIdx, textVal) {
    const rowId = document.getElementById('llm-row-selector').value;
    const tplId = document.getElementById('llm-template-selector').value;
    if (!rowId || !tplId) return;
    
    const row = batchMatrix.rows.find(r => r.id === rowId);
    const tpl = templates.find(t => t.id === tplId);
    if (!row || !tpl) return;
    
    const version = updateStoryVersionCaptionAt(row, tplId, tpl, stepIdx, textVal, {
        source: 'manual',
        prefix: '手写剧情'
    });
    saveMatrixToStorage();
    populateLlmStorySelector(version?.id || '');
}

// Global batch states
let llmCancelRequested = false;

function addLlmLog(msg, colorClass = "text-slate-400") {
    const logs = document.getElementById('llm-progress-logs');
    if (!logs) return;
    const time = new Date().toLocaleTimeString();
    logs.insertAdjacentHTML('beforeend', `<div class="${escapeHtml(colorClass)}">[${escapeHtml(time)}] ${escapeHtml(msg)}</div>`);
    logs.scrollTop = logs.scrollHeight;
}

function cancelLlmGeneration() {
    llmCancelRequested = true;
    addLlmLog("⚠️ 用户手动取消了剧情生成任务。", "text-amber-500 font-bold");
    document.getElementById('btn-llm-cancel-scripts').classList.add('hidden');
    document.getElementById('btn-llm-gen-scripts').disabled = false;
}

// Batch run storylines with LLM (with dynamic context and skip-on-error)
async function generateLlmStorylinesBatch() {
    const rowId = document.getElementById('llm-row-selector').value;
    const tplId = document.getElementById('llm-template-selector').value;
    
    if (!rowId || !tplId) {
        alert("请先选择要生成剧情的角色和模板！");
        return;
    }
    
    const row = batchMatrix.rows.find(r => r.id === rowId);
    const tpl = templates.find(t => t.id === tplId);
    
    if (!row || !tpl) return;
    
    const apiKey = document.getElementById('llm-api-key').value.trim();
    if (!apiKey) {
        alert("请先配置您的 LLM API Key！");
        return;
    }
    
    // Save current parameters in case they changed
    localStorage.setItem('llm_api_key', apiKey);
    localStorage.setItem('llm_base_url', document.getElementById('llm-base-url').value.trim());
    localStorage.setItem('llm_model_name', document.getElementById('llm-model-name').value.trim());
    
    const chunkSize = parseInt(document.getElementById('llm-chunk-size').value) || 10;
    localStorage.setItem('llm_chunk_size', chunkSize);
    saveLlmConfigFromDom();
    
    // UI state updates
    llmCancelRequested = false;
    document.getElementById('llm-progress-card').classList.remove('hidden');
    document.getElementById('btn-llm-cancel-scripts').classList.remove('hidden');
    document.getElementById('btn-llm-gen-scripts').disabled = true;
    
    const logs = document.getElementById('llm-progress-logs');
    logs.innerHTML = '';
    
    addLlmLog(`🧠 [LLM 剧本分批生成] 任务开启。角色: 《${row.bookTitle}》，模板: ${tpl.title}`, "text-purple-400 font-bold");
    
    const totalSteps = tpl.steps.length;
    
    // Substitute prompt variables
    const preparedPanels = tpl.steps.map((step, idx) => {
        const pText = replaceTemplatePlaceholders(step.prompt, row);
        return {
            name: step.name,
            prompt: pText
        };
    });
    
    const storyVersion = createStoryVersion(row, tplId, tpl, [], {
        source: 'llm',
        prefix: 'LLM剧情'
    });
    saveMatrixToStorage();
    populateLlmStorySelector(storyVersion?.id || '');
    renderLlmCaptionsList();
    addLlmLog(`本次生成将保存为剧情版本：「${storyVersion?.title || '新剧情'}」。`, "text-slate-400");
    
    let currentIdx = 0;
    
    while (currentIdx < totalSteps) {
        if (llmCancelRequested) {
            break;
        }
        
        const endIdx = Math.min(currentIdx + chunkSize, totalSteps);
        const chunk = preparedPanels.slice(currentIdx, endIdx);
        
        addLlmLog(`正在生成第 ${currentIdx + 1} 至 ${endIdx} 幕的剧情（共 ${totalSteps} 幕）...`, "text-slate-400");
        
        // Grab real-time text from the page textareas (up to currentIdx) as context
        const historyCaptions = [];
        for (let k = 0; k < currentIdx; k++) {
            const textEl = document.getElementById(`llm-caption-text-${k}`);
            const textVal = textEl ? textEl.value.trim() : (storyVersion?.captions?.[k] || '');
            if (textVal) {
                historyCaptions.push(textVal);
            }
        }
        
        try {
            const results = await requestLlmChunkCaptions(
                "", 
                chunk,
                row.bookTitle,
                currentIdx,
                historyCaptions
            );
            
            if (Array.isArray(results)) {
                results.forEach((cap, offset) => {
                    const stepIdx = currentIdx + offset;
                    if (storyVersion) storyVersion.captions[stepIdx] = cap;
                    
                    const txtArea = document.getElementById(`llm-caption-text-${stepIdx}`);
                    if (txtArea) {
                        txtArea.value = cap;
                    }
                });
                if (storyVersion) {
                    storyVersion.updatedAt = Date.now();
                    row.activeStoryVersionIds[tplId] = storyVersion.id;
                    row.captions[tplId] = storyVersion.captions.slice();
                }
                saveMatrixToStorage();
                populateLlmStorySelector(storyVersion?.id || '');
                addLlmLog(`第 ${currentIdx + 1} 至 ${endIdx} 幕剧情生成成功！`, "text-emerald-400");
            }
        } catch (err) {
            // Skip on error
            addLlmLog(`❌ 第 ${currentIdx + 1} 至 ${endIdx} 幕剧情生成失败，直接跳过。原因: ${err.message}`, "text-red-400 font-bold");
        }
        
        currentIdx += chunkSize;
        const percent = Math.min(100, Math.round((currentIdx / totalSteps) * 100));
        document.getElementById('llm-progress-pct').innerText = `${percent}%`;
        document.getElementById('llm-progress-bar-inner').style.width = `${percent}%`;
    }
    
    document.getElementById('btn-llm-cancel-scripts').classList.add('hidden');
    document.getElementById('btn-llm-gen-scripts').disabled = false;
    
    if (!llmCancelRequested) {
        addLlmLog(`🎉 剧本批量生成已全部结束。`, "text-emerald-400 font-bold");
        alert("剧情生成完毕！");
    }
}

// Single step redraw / regenerate storyline with preceding contexts
async function generateSingleStoryline(stepIdx, triggerButton = null) {
    const rowId = document.getElementById('llm-row-selector').value;
    const tplId = document.getElementById('llm-template-selector').value;
    
    if (!rowId || !tplId) return;
    
    const row = batchMatrix.rows.find(r => r.id === rowId);
    const tpl = templates.find(t => t.id === tplId);
    if (!row || !tpl) return;
    
    const apiKey = document.getElementById('llm-api-key').value.trim();
    if (!apiKey) {
        alert("请先配置您的 LLM API Key！");
        return;
    }
    
    // Save API configs
    localStorage.setItem('llm_api_key', apiKey);
    localStorage.setItem('llm_base_url', document.getElementById('llm-base-url').value.trim());
    localStorage.setItem('llm_model_name', document.getElementById('llm-model-name').value.trim());
    saveLlmConfigFromDom();
    
    const btn = triggerButton || document.querySelector(`[data-single-story-btn="${stepIdx}"]`);
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader" class="w-3 h-3 animate-spin"></i> <span>正在生成...</span>`;
        initLucide(btn);
    }
    
    // Grab all real-time text up to stepIdx
    const storyVersion = ensureEditableStoryVersion(row, tplId, tpl, {
        source: 'llm-single',
        prefix: '单幕剧情'
    });
    const historyCaptions = [];
    for (let k = 0; k < stepIdx; k++) {
        const textEl = document.getElementById(`llm-caption-text-${k}`);
        const textVal = textEl ? textEl.value.trim() : (storyVersion?.captions?.[k] || '');
        if (textVal) {
            historyCaptions.push(`【第 ${k + 1} 幕】：${textVal}`);
        }
    }
    const previousContext = historyCaptions.join('\n');
    
    const step = tpl.steps[stepIdx];
    const resolvedPrompt = replaceTemplatePlaceholders(step.prompt, row);
    
    try {
        const result = await requestLlmContinuity(
            "", 
            resolvedPrompt,
            previousContext,
            stepIdx + 1,
            tpl.steps.length
        );
        
        if (result) {
            if (storyVersion) {
                storyVersion.captions[stepIdx] = result;
                storyVersion.updatedAt = Date.now();
                row.activeStoryVersionIds[tplId] = storyVersion.id;
                row.captions[tplId] = storyVersion.captions.slice();
            }
            const txtArea = document.getElementById(`llm-caption-text-${stepIdx}`);
            if (txtArea) {
                txtArea.value = result;
            }
            saveMatrixToStorage();
            populateLlmStorySelector(storyVersion?.id || '');
        }
    } catch (err) {
        alert(`生成失败: ${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            initLucide(btn);
        }
    }
}

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
