// app.js - 核心生命周期与交互管线大控制器

// Data Structures & State
window.isAppInitializing = true;
let templates = [];
let activeTemplateId = null;
let batchMatrix = {
    columns: ["character", "style"], // Always contains 'character' and 'style'
    rows: []
};
let comfyWorkflows = []; // [{ id: "wf_xxx", name: "工作流一", raw: {...}, nodePositive: "6", nodeNegative: "", nodeOutput: "9" }]
let activeWorkflowId = null;
let comfyWorkflowRaw = null; 
let isMockMode = false;
let runningBatch = false;
let cancelRequested = false;
let savedGalleries = [];
const BATCH_STATE_KEY = 'comfy_comic_batch_state';
const BATCH_SESSION_ID = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let appReadyPromise = Promise.resolve();
let batchRunState = createEmptyBatchRunState();

// 100% 离线安全、高度容错的纯本地 SVG 矢量降级占位图（替代外网 Unsplash 地址）
const OFFLINE_PLACEHOLDER_IMAGE = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="100%" height="100%" fill="%230f172a"/><g transform="translate(300, 200)" text-anchor="middle" fill="%2364748b"><rect x="-80" y="-80" width="160" height="160" rx="16" fill="%231e293b" stroke="%23334155" stroke-width="2"/><circle cx="0" cy="-15" r="24" fill="none" stroke="%2364748b" stroke-width="4"/><path d="M-40,40 L40,40 L25,15 L5,25 L-20,0 Z" fill="%2364748b"/><text y="120" font-size="15" font-family="system-ui, sans-serif" font-weight="bold" fill="%2394a3b8">图片绘制失败 (已安全降级)</text><text y="145" font-size="11" font-family="system-ui, sans-serif" fill="%23475569">本地服务离线或 ComfyUI 轮询超时</text></g></svg>`;


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
                image: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=600"
            },
            {
                name: "二幕：街头起舞",
                prompt: "Action shot, a gorgeous 20-year-old girl with vibrant long red hair and green eyes, anime illustration style, digital painting, vibrant colors, dancing passionately, wind blowing hair, neon signs and glowing lights in the background, high dynamic action, emotion in eyes, wearing a classic white jacket and denim shorts",
                caption: "路旁音响飘扬起熟悉的旋律，伴着节奏，她情不自禁地随风起舞，吸引了路人的目光。",
                image: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=600"
            },
            {
                name: "三幕：华服晚宴",
                prompt: "Cinematic portrait, a gorgeous 20-year-old girl with vibrant long red hair and green eyes, anime illustration style, digital painting, vibrant colors, wearing an elegant sparkling formal evening dress, performing an elegant classical dance under luxurious chandeliers, magical atmosphere, depth of field",
                caption: "夜幕降临，她换上了一身璀璨的晚礼服，在华丽的霓虹灯影中尽情倾诉。",
                image: "https://images.unsplash.com/photo-1496440737103-cd596325d314?auto=format&fit=crop&q=80&w=600"
            },
            {
                name: "四幕：温馨晚安",
                prompt: "Cozy close-up shot, a gorgeous 20-year-old girl with vibrant long red hair and green eyes sleeping soundly in a warm cozy bedroom bed, covered in a soft blanket, gentle moonlight through the window, peaceful, hyper-detailed, soft shadows",
                caption: "繁盛喧嚣散尽，带着满足的心绪和闪闪发光的梦境，进入甜蜜安宁的梦乡。",
                image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=600"
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
                image: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600"
            },
            {
                name: "二幕：街头起舞",
                prompt: "Action shot, a cool mechanical-cybernetic detective with glowing blue neon eyes, white hair, gritty cyberpunk style, futuristic, rain-slicked city streets, moody volumetric lighting, dancing passionately, wind blowing hair, neon signs and glowing lights in the background, high dynamic action, emotion in eyes, wearing a dark leather trenchcoat with yellow holographic patches",
                caption: "为了对抗过载的心智，他在全息虚拟舞厅的节奏脉冲中释放重金属般的狂热重组。",
                image: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&q=80&w=600"
            },
            {
                name: "三幕：华服晚宴",
                prompt: "Cinematic portrait, a cool mechanical-cybernetic detective with glowing blue neon eyes, white hair, gritty cyberpunk style, futuristic, rain-slicked city streets, moody volumetric lighting, wearing an elegant sparkling formal evening dress, performing an elegant classical dance under luxurious chandeliers, magical atmosphere, depth of field",
                caption: "换上一身剪裁得体、极具未来主义的西装，他游走在巨头晚宴与致命迷雾的核心交界点。",
                image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&q=80&w=600"
            },
            {
                name: "四幕：温馨晚安",
                prompt: "Cozy close-up shot, a cool mechanical-cybernetic detective with glowing blue neon eyes, white hair sleeping soundly in a warm cozy bedroom bed, covered in a soft blanket, gentle moonlight through the window, peaceful, hyper-detailed, soft shadows",
                caption: "拔掉神经缆线，让超负荷的数据内核陷入纯粹的死循环冷却中。晚安，钢铁城市。",
                image: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=600"
            }
        ]
    }
];


// Initialize App
window.addEventListener('DOMContentLoaded', () => {
    appReadyPromise = loadLocalStorageData().then(() => {
        window.isAppInitializing = false;
        console.log('[Sync] App initialization finished. Server saving is now enabled.');
    });
    initLucide();
    renderTemplatesList();
    renderMatrixTable();
    populateTemplateDropdowns();
    renderGallery();
    renderBatchConsoleFromState();
    
    // Check comfy status periodically
    testComfyConnection(true);
});

window.addEventListener('beforeunload', (event) => {
    if (!runningBatch) return;
    batchRunState.status = 'active';
    batchRunState.sessionId = BATCH_SESSION_ID;
    saveBatchRunStateToStorage(false);
    event.preventDefault();
    event.returnValue = '';
});

function initLucide(rootElement = null) {
    if (rootElement) {
        lucide.createIcons({ root: rootElement });
    } else {
        lucide.createIcons();
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
}

// Synchronous LocalStorage load (First screen fast render)
function syncLoadFromLocalStorage() {
    // Load templates
    const savedTpls = localStorage.getItem('comfy_comic_templates');
    if (savedTpls) {
        templates = JSON.parse(savedTpls);
    } else {
        templates = JSON.parse(JSON.stringify(defaultTemplates));
        localStorage.setItem('comfy_comic_templates', JSON.stringify(templates));
    }
    activeTemplateId = templates[0]?.id || null;

    // Load batch matrix
    const savedMatrix = localStorage.getItem('comfy_comic_matrix');
    if (savedMatrix) {
        batchMatrix = JSON.parse(savedMatrix);
    } else {
        batchMatrix.rows = JSON.parse(JSON.stringify(defaultMatrixRows));
        localStorage.setItem('comfy_comic_matrix', JSON.stringify(batchMatrix));
    }

    // Load Galleries
    const savedG = localStorage.getItem('comfy_comic_galleries');
    if (savedG) {
        savedGalleries = JSON.parse(savedG);
        savedGalleries.forEach(book => {
            if (book.steps) {
                book.steps.forEach(step => {
                    if (step.image && step.image.includes('photo-1511295742364')) {
                        step.image = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=600';
                    }
                });
            }
        });
        localStorage.setItem('comfy_comic_galleries', JSON.stringify(savedGalleries));
    } else {
        savedGalleries = JSON.parse(JSON.stringify(seedGalleries));
        localStorage.setItem('comfy_comic_galleries', JSON.stringify(savedGalleries));
    }

    // Load comfy nodes setup (multi workflow)
    const savedWorkflows = localStorage.getItem('comfy_workflows');
    const savedActiveId = localStorage.getItem('comfy_active_workflow_id');
    if (savedWorkflows) {
        comfyWorkflows = JSON.parse(savedWorkflows);
    }
    if (savedActiveId) {
        activeWorkflowId = savedActiveId;
    }

    loadBatchRunStateFromStorage();
}

// Master state initialization wrapper (Combines LocalStorage and ComfyUI server disk storage)
async function loadLocalStorageData() {
    // 1. 先同步加载本地缓存（秒开首屏）
    syncLoadFromLocalStorage();
    
    // Migrate from old single workflow if list is empty
    if (comfyWorkflows.length === 0) {
        const oldRaw = localStorage.getItem('comfy_workflow_raw');
        if (oldRaw) {
            const parsedOld = JSON.parse(oldRaw);
            const oldId = "wf_" + Date.now();
            comfyWorkflows.push({
                id: oldId,
                name: "已导入的工作流",
                raw: parsedOld,
                nodePositive: localStorage.getItem('comfy_node_positive') || '6',
                nodeNegative: localStorage.getItem('comfy_node_negative') || '',
                nodeOutput: localStorage.getItem('comfy_node_output') || '9'
            });
            activeWorkflowId = oldId;
            saveWorkflowsToStorage();
        }
    }

    renderWorkflowSelector();
    if (activeWorkflowId) {
        selectWorkflow(activeWorkflowId, false);
    }

    document.getElementById('comfy-url-input').value = localStorage.getItem('comfy_api_url') || 'http://127.0.0.1:8188';

    // Load LLM keys
    document.getElementById('llm-base-url').value = localStorage.getItem('llm_base_url') || 'https://api.openai.com/v1';
    document.getElementById('llm-api-key').value = localStorage.getItem('llm_api_key') || '';
    document.getElementById('llm-model-name').value = localStorage.getItem('llm_model_name') || 'gpt-4o';
    
    // 强制关闭模拟模式，默认采用真实绘图与LLM生成
    isMockMode = false;
    
    // 初始化 LLM 相关设置
    const savedProvider = localStorage.getItem('llm_provider') || 'openai';
    const providerSel = document.getElementById('llm-provider');
    if (providerSel) providerSel.value = savedProvider;
    
    const savedChunkSize = localStorage.getItem('llm_chunk_size') || '10';
    const chunkInput = document.getElementById('llm-chunk-size');
    if (chunkInput) chunkInput.value = savedChunkSize;

    syncXmlSystemPromptInput();

    // Bind Node ID text input events for persistence
    document.getElementById('node-id-positive').addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('node-select-positive').value = val;
        updateActiveWorkflowConfig('nodePositive', val);
    });
    document.getElementById('node-id-negative').addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('node-select-negative').value = val;
        updateActiveWorkflowConfig('nodeNegative', val);
    });
    document.getElementById('node-id-output').addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('node-select-output').value = val;
        updateActiveWorkflowConfig('nodeOutput', val);
    });

    // 2. 异步尝试从 ComfyUI 后端服务器磁盘拉取最新落盘配置
    const loadedFromServer = await loadConfigFromComfyServer();
    if (loadedFromServer) {
        // 如果服务器磁盘有最新的，强制重新绘制所有视图模块，保证完全同步落盘状态
        renderTemplatesList();
        renderMatrixTable();
        populateTemplateDropdowns();
        renderGallery();
        renderWorkflowSelector();
        if (activeWorkflowId) {
            selectWorkflow(activeWorkflowId, false);
        }
    }
    reviveInterruptedBatchIfNeeded();
    syncXmlSystemPromptInput();
}

function saveTemplatesToStorage() {
    updateLastActiveTime();
    localStorage.setItem('comfy_comic_templates', JSON.stringify(templates));
    saveConfigToComfyServer();
}

function saveMatrixToStorage() {
    updateLastActiveTime();
    localStorage.setItem('comfy_comic_matrix', JSON.stringify(batchMatrix));
    saveConfigToComfyServer();
}

function saveGalleriesToStorage() {
    updateLastActiveTime();
    localStorage.setItem('comfy_comic_galleries', JSON.stringify(savedGalleries));
    saveConfigToComfyServer();
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
        renderLlmCaptionsList();
    }
}

// --- TAB 1: PIXIV GALLERY RENDERING ---
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
        const steps = Array.isArray(book.steps) ? book.steps : [];
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
        const statusBadge = isInProgress
            ? '<div class="absolute top-2 right-2 bg-amber-500 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow animate-pulse">生成中</div>'
            : isCanceled
                ? '<div class="absolute top-2 right-2 bg-red-600 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow">已中断</div>'
                : isFailed
                    ? '<div class="absolute top-2 right-2 bg-red-700 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow">失败</div>'
                    : '';

        const cardHtml = `
            <div onclick="openPixivModal('${book.id}')" class="group bg-white dark:bg-slate-900 rounded-2xl overflow-hidden pixiv-card-shadow border border-slate-100 dark:border-slate-800 hover:scale-[1.02] transition-all duration-300 cursor-pointer flex flex-col justify-between h-[360px] relative">
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
                        onclick="event.stopPropagation(); deleteGallery('${book.id}')"
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
                    </div>
                    
                    <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                        ${escapeHtml(book.synopsis || "暂无剧本介绍。")}
                    </p>

                    <div class="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-2 text-[10px] text-slate-400">
                        <span class="flex items-center gap-1">
                            <i data-lucide="heart" class="w-3.5 h-3.5 text-pink-500 fill-pink-500/20"></i>
                            <span>${Math.floor(Math.random() * 80) + 12} 赞</span>
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
    saveGalleriesToStorage();
    renderGallery();
    addLog(`已删除画册：${book.title}`);
}

// Immersive modal viewer
function openPixivModal(bookId) {
    const book = savedGalleries.find(b => b.id === bookId);
    if (!book) return;

    activeBookId = bookId; // cache selected
    
    document.getElementById('modal-title').innerText = book.title;
    document.getElementById('modal-synopsis').innerText = book.synopsis || "暂无全局剧情。";
    
    // Render tags
    const tagsContainer = document.getElementById('modal-tags');
    tagsContainer.innerHTML = '';
    const allTags = book.tags || ["AI漫画", "ComfyUI", "批量绘图"];
    allTags.forEach(t => {
        tagsContainer.insertAdjacentHTML('beforeend', `
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">#${t}</span>
        `);
    });

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

    book.steps.forEach((step, idx) => {
        const stepImage = step.image || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600";
        
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
                    <img src="${escapeHtml(cleanImageSrc)}" alt="${escapeHtml(step.name)}" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600';">
                    
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
                <button onclick="toggleSidebarAccordion('${book.id}', ${idx})" class="w-full p-3 flex items-start gap-2.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800/40 transition">
                    <span class="w-5 h-5 rounded-full bg-blue-500/10 text-blue-500 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">${idx + 1}</span>
                    <div class="flex-grow space-y-0.5 min-w-0">
                        <div class="flex justify-between items-center">
                            <h5 class="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">${escapeHtml(step.name)}</h5>
                            <i data-lucide="chevron-down" id="accordion-arrow-${book.id}-${idx}" class="w-3.5 h-3.5 text-slate-400 transition-transform duration-200"></i>
                        </div>
                        <p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">${escapeHtml(step.caption || "尚未填充旁白。")}</p>
                    </div>
                </button>

                <!-- Expandable details pane -->
                <div id="accordion-pane-${book.id}-${idx}" class="hidden p-3.5 border-t border-slate-200/60 dark:border-slate-800/60 bg-white dark:bg-slate-950/40 space-y-3">
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
                        <button onclick="toggleSingleRedrawPanel('${book.id}', ${idx})" class="py-1 px-3 rounded-lg bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 text-blue-500 dark:text-blue-400 text-[10px] font-bold flex items-center gap-1.5 transition">
                            <i data-lucide="edit-3" class="w-3 h-3"></i> 单页精修重绘
                        </button>
                    </div>

                    <!-- Redraw form subpanel -->
                    <div id="redraw-panel-${book.id}-${idx}" class="hidden p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5">
                        <label class="block text-[10px] text-slate-400 font-bold">精修该分镜提示词：</label>
                        <textarea id="redraw-prompt-${book.id}-${idx}" class="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-xs focus:outline-none font-mono focus:border-blue-500 transition text-slate-800 dark:text-slate-200" rows="3">${escapeHtml(step.prompt)}</textarea>
                        <div class="flex justify-end gap-1.5">
                            <button onclick="toggleSingleRedrawPanel('${book.id}', ${idx})" class="px-2.5 py-1 text-[10px] bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 font-bold transition">取消</button>
                            <button onclick="executeSingleRedraw('${book.id}', ${idx})" class="px-2.5 py-1 text-[10px] bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center gap-1 transition">
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
    initLucide();
}

function closePixivModal() {
    const modal = document.getElementById('pixiv-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

let activeBookId = null;
function likeCurrentBook() {
    alert("点赞成功！您的支持是作者创作的动力 ❤️");
}

// Export Manga as simple single page html file
function exportMangaHTML() {
    const book = savedGalleries.find(b => b.id === activeBookId);
    if (!book) return;

    let stepsHTML = '';
    book.steps.forEach((step, idx) => {
        stepsHTML += `
            <div class="step-card">
                <img src="${step.image}" alt="${step.name}">
                <div class="badge">第 ${idx+1} 幕 · ${step.name}</div>
                <div class="caption">${step.caption}</div>
            </div>
        `;
    });

    const templateContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>${book.title} - ComfyComic PDF故事本</title>
    <style>
        body { font-family: sans-serif; background: #0b0f19; color: #f1f5f9; text-align: center; margin: 0; padding: 40px 20px; }
        .manga-container { max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: 40px; }
        .header { margin-bottom: 20px; border-bottom: 1px solid #1e293b; padding-bottom: 20px; }
        h1 { font-size: 28px; margin: 0 0 10px; color: #3b82f6; }
        p { color: #94a3b8; font-size: 14px; }
        .step-card { background: #111827; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); position: relative; }
        img { width: 100%; display: block; aspect-ratio: 4/3; object-fit: cover; }
        .badge { position: absolute; top: 15px; left: 15px; background: rgba(0,0,0,0.7); padding: 5px 12px; font-size: 12px; border-radius: 6px; font-weight: bold; }
        .caption { padding: 20px; font-size: 16px; line-height: 1.6; font-weight: 500; }
    </style>
</head>
<body>
    <div class="manga-container">
        <div class="header">
            <h1>${book.title}</h1>
            <p>${book.synopsis}</p>
        </div>
        ${stepsHTML}
    </div>
</body>
</html>`;

    const blob = new Blob([templateContent], { type: 'text/html' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${book.title}_漫画分享.html`;
    link.click();
}


// --- TAB 2: TEMPLATE EDITOR ---
function renderTemplatesList() {
    const container = document.getElementById('templates-list-container');
    container.innerHTML = '';

    templates.forEach(t => {
        const isActive = t.id === activeTemplateId;
        const activeClasses = isActive 
            ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-l-4 border-blue-500 font-bold" 
            : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border-l-4 border-transparent";

        const tplCard = `
            <div onclick="selectTemplate('${t.id}')" class="p-2.5 rounded-lg border-b border-slate-100 dark:border-slate-800/40 transition-all duration-150 cursor-pointer flex justify-between items-center ${activeClasses}">
                <span class="text-xs truncate w-40" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
                <span class="text-[9px] bg-slate-200/60 dark:bg-slate-800 text-slate-500 font-mono px-1.5 py-0.5 rounded shrink-0">${t.steps.length}P</span>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', tplCard);
    });
    initLucide();
    populateActiveTemplateSteps();
}

function selectTemplate(tplId) {
    activeTemplateId = tplId;
    renderTemplatesList();
}

function createNewTemplate() {
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
    if (confirm("确定要恢复默认模板吗？这将覆盖您现有的模板。")) {
        templates = JSON.parse(JSON.stringify(defaultTemplates));
        activeTemplateId = templates[0].id;
        saveTemplatesToStorage();
        renderTemplatesList();
        populateTemplateDropdowns();
    }
}

function deleteCurrentTemplate() {
    if (templates.length <= 1) {
        alert("抱歉，您至少要保留一个画册模板。");
        return;
    }
    if (confirm("确定要删除当前模板吗？此操作不可逆。")) {
        templates = templates.filter(t => t.id !== activeTemplateId);
        activeTemplateId = templates[0].id;
        saveTemplatesToStorage();
        renderTemplatesList();
        populateTemplateDropdowns();
    }
}

function saveCurrentTemplate() {
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
                    <span class="text-xs font-bold font-mono text-blue-500">分镜 0${idx + 1} / FRAME</span>
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
                        <span class="text-[9px] text-indigo-400 font-mono">支持 {character}, {style}, {outfit} 等占位符</span>
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
                    <textarea oninput="updateMatrixCellValue(${rIdx}, '${col}', this.value)" rows="2" class="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 rounded-lg p-1.5 focus:outline-none text-[11px] leading-normal select-text" placeholder="输入变量内容">${cellVal}</textarea>
                </td>
            `;
        });

        const rowHtml = `
            <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition text-slate-700 dark:text-slate-300">
                <td class="p-3 text-center">
                    <input type="checkbox" ${row.active ? 'checked' : ''} onchange="toggleMatrixRowActive(${rIdx}, this.checked)" class="w-4 h-4 rounded text-blue-500 accent-blue-500 focus:ring-0 bg-gray-100 border-gray-300">
                </td>
                <td class="p-3">
                    <input type="text" value="${row.bookTitle || ''}" oninput="updateMatrixCellValue(${rIdx}, 'bookTitle', this.value)" class="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 rounded-lg p-1.5 focus:outline-none text-[11px] font-bold" placeholder="起个亮眼的标题">
                </td>
                ${columnsHtml}
                <td class="p-3 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick="openScriptModal('${row.id}')" class="p-1.5 rounded hover:bg-purple-500/10 text-slate-400 hover:text-purple-500 transition" title="手动审阅/编辑本组剧本旁白">
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
    batchMatrix.rows[rIdx][colName] = value;
    saveMatrixToStorage();
}

function toggleMatrixRowActive(rIdx, isChecked) {
    batchMatrix.rows[rIdx].active = isChecked;
    saveMatrixToStorage();
}

function addMatrixRow() {
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
    const varName = prompt("请输入您在模板中设计的自定义占位符名称（不需要写花括号）：\n例如，若要替换 {outfit}，输入 outfit 即可。");
    if (!varName) return;

    const sanitized = varName.trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!sanitized) {
        alert("无效的字符名称。");
        return;
    }

    if (batchMatrix.columns.includes(sanitized) || sanitized === 'bookTitle' || sanitized === 'active') {
        alert("该字段名称已存在或属于保留字段。");
        return;
    }

    batchMatrix.columns.push(sanitized);
    
    const dynamicThPlaceholder = document.getElementById('dynamic-th-placeholder');
    dynamicThPlaceholder.insertAdjacentHTML('beforebegin', `
        <th class="p-3 min-w-[120px] text-purple-400 font-mono dynamic-th" data-col="${sanitized}">{${sanitized}} (新变量)</th>
    `);

    saveMatrixToStorage();
    renderMatrixTable();
}

function populateTemplateDropdowns() {
    const sel = document.getElementById('matrix-template-selector');
    if (sel) {
        sel.innerHTML = '';
        templates.forEach(t => {
            sel.insertAdjacentHTML('beforeend', `
                <option value="${t.id}">${escapeHtml(t.title)} (${t.steps.length} 幕)</option>
            `);
        });
    }

    const llmSel = document.getElementById('llm-template-selector');
    if (llmSel) {
        llmSel.innerHTML = '';
        templates.forEach(t => {
            llmSel.insertAdjacentHTML('beforeend', `
                <option value="${t.id}">${escapeHtml(t.title)} (${t.steps.length} 幕)</option>
            `);
        });
    }

    populateLlmRowSelector();
}


// --- TAB 4: WORKFLOW HELPERS ---
function saveWorkflowsToStorage() {
    updateLastActiveTime();
    localStorage.setItem('comfy_workflows', JSON.stringify(comfyWorkflows));
    localStorage.setItem('comfy_active_workflow_id', activeWorkflowId);
    saveConfigToComfyServer();
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
            <option value="${wf.id}" ${isSelected}>${wf.name}</option>
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
        saveWorkflowsToStorage();
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
            posSel.insertAdjacentHTML('beforeend', `<option value="${nodeId}">${displayName}</option>`);
            negSel.insertAdjacentHTML('beforeend', `<option value="${nodeId}">${displayName}</option>`);
        }

        if (type.includes('Save') || type.includes('Preview') || type.includes('Image') || type.includes('Output')) {
            outSel.insertAdjacentHTML('beforeend', `<option value="${nodeId}">${displayName}</option>`);
        }
    });

    posSel.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('node-id-positive').value = val;
        updateActiveWorkflowConfig('nodePositive', val);
    });
    negSel.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('node-id-negative').value = val;
        updateActiveWorkflowConfig('nodeNegative', val);
    });
    outSel.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('node-id-output').value = val;
        updateActiveWorkflowConfig('nodeOutput', val);
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
            let finalPrompt = step.prompt;
            let finalCaption = step.caption;
            batchMatrix.columns.forEach(col => {
                const replaceVal = row[col] || "";
                const regex = new RegExp(`{${col}}`, "g");
                finalPrompt = finalPrompt.replace(regex, replaceVal);
                finalCaption = finalCaption.replace(regex, replaceVal);
            });
            finalPrompt = finalPrompt.replace(/{bookTitle}/g, row.bookTitle);
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
            
            if (!row.captions) row.captions = {};
            row.captions[tplId] = captions;
            saveMatrixToStorage();
            
            addLog(`✅ 角色【${row.bookTitle}】剧本已全量构思成功！`, "text-emerald-400");
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

    document.getElementById('script-modal-title').innerText = `${row.bookTitle} (${tpl.title})`;
    const container = document.getElementById('script-editor-container');
    container.innerHTML = '';

    if (!row.captions) row.captions = {};
    if (!row.captions[tplId]) {
        // Fallback initialized captions list
        row.captions[tplId] = tpl.steps.map(step => {
            let finalCaption = step.caption;
            batchMatrix.columns.forEach(col => {
                const replaceVal = row[col] || "";
                const regex = new RegExp(`{${col}}`, "g");
                finalCaption = finalCaption.replace(regex, replaceVal);
            });
            return finalCaption;
        });
    }

    const currentCaptions = row.captions[tplId];

    tpl.steps.forEach((step, idx) => {
        const val = currentCaptions[idx] || "";
        const itemHtml = `
            <div class="space-y-1.5 p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-slate-500 dark:text-slate-400">${step.name}</span>
                </div>
                <textarea rows="2" class="script-textarea w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-xs focus:outline-none" data-idx="${idx}">${val}</textarea>
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
}

function saveAndCloseScriptModal() {
    if (!editingRowId) return;
    const row = batchMatrix.rows.find(r => r.id === editingRowId);
    if (!row) return;

    const tplId = document.getElementById('matrix-template-selector').value;
    const textareas = document.querySelectorAll('.script-textarea');
    
    if (!row.captions) row.captions = {};
    const captionsArray = [];
    textareas.forEach(ta => {
        const idx = parseInt(ta.getAttribute('data-idx'));
        captionsArray[idx] = ta.value;
    });

    row.captions[tplId] = captionsArray;
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
            let finalPrompt = step.prompt;
            let finalCaption = step.caption;
            batchMatrix.columns.forEach(col => {
                const replaceVal = row[col] || "";
                const regex = new RegExp(`{${col}}`, "g");
                finalPrompt = finalPrompt.replace(regex, replaceVal);
                finalCaption = finalCaption.replace(regex, replaceVal);
            });
            finalPrompt = finalPrompt.replace(/{bookTitle}/g, row.bookTitle);
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

        if (!row.captions) row.captions = {};
        row.captions[tplId] = captions;
        saveMatrixToStorage();

        const textareas = document.querySelectorAll('.script-textarea');
        textareas.forEach(ta => {
            const idx = parseInt(ta.getAttribute('data-idx'));
            ta.value = captions[idx] || "";
        });

        alert("AI 剧本生成并装填成功！");
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

            const characterLabel = (row.character || row.bookTitle || "未命名角色").trim();
            const newBook = {
                id: "book_" + Date.now() + "_" + i,
                title: bookTitle || `探索画册_${i}`,
                characterName: characterLabel ? characterLabel.substring(0, 10) + "..." : "未命名角色",
                templateTitle: tpl.title,
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
            saveGalleriesToStorage();
            renderGallery();
            setBatchRunState('active', {
                activeBookId: newBook.id,
                currentBookTitle: newBook.title,
                progressLabel: `正在生成第 ${currentBookIndex}/${totalBooks} 套故事`
            }, true);

            // Prepare final prompts with variables
            const preparedPanels = tpl.steps.map((step, idx) => {
                let finalPrompt = step.prompt;
                let finalCaption = step.caption;
                batchMatrix.columns.forEach(col => {
                    const replaceVal = row[col] || "";
                    const regex = new RegExp(`{${col}}`, "g");
                    finalPrompt = finalPrompt.replace(regex, replaceVal);
                    finalCaption = finalCaption.replace(regex, replaceVal);
                });
                finalPrompt = finalPrompt.replace(/{bookTitle}/g, bookTitle);
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
                if (row.captions && row.captions[tplId] && row.captions[tplId][j]) {
                    generatedStoryLine = row.captions[tplId][j];
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
                    renderedImgUrl = getMockVisual(row.style, j);
                    addLog(`✅ [模拟成功] 图像已接收！`, "text-emerald-500");
                }

                newBook.steps.push({
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
        saveGalleriesToStorage();
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
            newImgUrl = getMockVisual(book.steps[stepIdx].prompt || "anime", stepIdx + 8);
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

// Helper to update local updated timestamp
function updateLastActiveTime() {
    const now = Date.now();
    localStorage.setItem('comfy_comic_updated_at', now.toString());
    return now;
}

// Push state payload to local Python backend server to write to disk comfy_comic_data.json
async function saveConfigToComfyServer() {
    if (window.isAppInitializing) {
        console.warn('[Sync] Blocked saveConfigToComfyServer call during app initialization.');
        return;
    }
    // 每次开始调用，确保本地时间戳已同步更新
    updateLastActiveTime();

    if (saveDebounceTimeout) {
        clearTimeout(saveDebounceTimeout);
    }

    return new Promise((resolve) => {
        saveDebounceTimeout = setTimeout(async () => {
            await enqueueSaveTask();
            resolve();
        }, 500); // 500ms Debounce
    });
}

// Queue actual network saves to prevent multi-request packet out-of-order execution
async function enqueueSaveTask() {
    saveQueuePromise = saveQueuePromise.then(async () => {
        await executeServerSave();
    }).catch(err => {
        console.error('[Sync] Queue execution encountered error: ', err);
    });
    return saveQueuePromise;
}

// Internal server saving executor
async function executeServerSave() {
    const backendUrl = window.location.protocol.startsWith('http') 
        ? '/api/config' 
        : 'http://127.0.0.1:8777/api/config';

    const syncStatusEl = document.getElementById('cloud-sync-status');
    if (syncStatusEl) {
        syncStatusEl.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin text-blue-500"></i> <span class="text-xs text-slate-400">同步至云端...</span>`;
        initLucide(syncStatusEl);
    }

    const appState = {
        templates: templates,
        batchMatrix: batchMatrix,
        savedGalleries: savedGalleries,
        comfyWorkflows: comfyWorkflows,
        activeWorkflowId: activeWorkflowId,
        batchRunState: batchRunState,
        xmlSystemPrompt: localStorage.getItem('xml_system_prompt') || '',
        nodePositive: localStorage.getItem('comfy_node_positive') || '6',
        nodeNegative: localStorage.getItem('comfy_node_negative') || '',
        nodeOutput: localStorage.getItem('comfy_node_output') || '9',
        updatedAt: parseInt(localStorage.getItem('comfy_comic_updated_at') || '0')
    };

    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(appState)
        });

        if (response.ok) {
            console.log('[Sync] Disk backup persistent success.');
            if (syncStatusEl) {
                syncStatusEl.innerHTML = `<i data-lucide="cloud-check" class="w-3.5 h-3.5 text-emerald-500"></i> <span class="text-xs text-slate-400">已保存至云端</span>`;
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

// Pull config state from local Python backend server data JSON file and synchronize
async function loadConfigFromComfyServer() {
    const backendUrl = window.location.protocol.startsWith('http') 
        ? '/api/config' 
        : 'http://127.0.0.1:8777/api/config';
    
    const syncStatusEl = document.getElementById('cloud-sync-status');
    if (syncStatusEl) {
        syncStatusEl.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin text-blue-500"></i> <span class="text-xs text-slate-400">与云端同步中...</span>`;
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

        const localUpdatedAt = localStorage.getItem('comfy_comic_updated_at') !== null ? parseInt(localStorage.getItem('comfy_comic_updated_at') || '0') : -1;
        const serverUpdatedAt = parseInt(appState.updatedAt || '0');

        console.log(`[Sync] Timestamp Check - Local: ${localUpdatedAt}, Server: ${serverUpdatedAt}`);

        // 如果本地被用户修改的时间戳最新，说明拉取时发生了更近的写操作或离线更新，阻止覆盖，并反向同步
        if (localUpdatedAt > serverUpdatedAt) {
            console.warn('[Sync] Local state is newer. Overwrite cloud config with local configs.');
            saveConfigToComfyServer();
            if (syncStatusEl) syncStatusEl.innerHTML = '';
            return false;
        }

        if (appState) {
            if (appState.templates) {
                templates = appState.templates;
                localStorage.setItem('comfy_comic_templates', JSON.stringify(templates));
            }
            if (appState.batchMatrix) {
                batchMatrix = appState.batchMatrix;
                localStorage.setItem('comfy_comic_matrix', JSON.stringify(batchMatrix));
            }
            if (appState.savedGalleries) {
                savedGalleries = appState.savedGalleries;
                // Auto hot-migration for broken unsplash images
                savedGalleries.forEach(book => {
                    if (book.steps) {
                        book.steps.forEach(step => {
                            if (step.image && step.image.includes('photo-1511295742364')) {
                                step.image = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=600';
                            }
                        });
                    }
                });
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
                batchRunState = normalizeBatchRunState(appState.batchRunState);
                localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(batchRunState));
            }
            if (Object.prototype.hasOwnProperty.call(appState, 'xmlSystemPrompt')) {
                localStorage.setItem('xml_system_prompt', appState.xmlSystemPrompt || '');
                const xmlSystemPromptInput = document.getElementById('xml-system-prompt');
                if (xmlSystemPromptInput) {
                    xmlSystemPromptInput.value = appState.xmlSystemPrompt || (window.DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT || '');
                }
            }
            if (appState.nodePositive) localStorage.setItem('comfy_node_positive', appState.nodePositive);
            if (appState.nodeNegative) localStorage.setItem('comfy_node_negative', appState.nodeNegative);
            if (appState.nodeOutput) localStorage.setItem('comfy_node_output', appState.nodeOutput);
            
            // 将服务器拉取来的最新时间戳写入本地作为同步基线
            localStorage.setItem('comfy_comic_updated_at', serverUpdatedAt.toString());

            console.log('[LocalServer] Master state configuration loaded from local disk successfully!');
            
            if (syncStatusEl) {
                syncStatusEl.innerHTML = `<i data-lucide="cloud-lightning" class="w-3.5 h-3.5 text-emerald-500"></i> <span class="text-xs text-slate-400">已同步云端最新</span>`;
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
        rowSel.innerHTML += `<option value="${r.id}">${r.bookTitle}</option>`;
    });
    
    // Add row selection change listener to dynamically refresh vertical list
    if (!rowSel.onchange) {
        rowSel.onchange = () => renderLlmCaptionsList();
    }
}

// Render dynamic captions list
function onLlmTemplateChange() {
    renderLlmCaptionsList();
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
    
    if (!row.captions) row.captions = {};
    if (!row.captions[tplId]) {
        row.captions[tplId] = [];
    }
    
    tpl.steps.forEach((step, idx) => {
        let currentText = row.captions[tplId][idx];
        if (currentText === undefined) {
            currentText = ''; 
        }
        
        let resolvedPrompt = step.prompt;
        batchMatrix.columns.forEach(col => {
            const regex = new RegExp(`{${col}}`, 'g');
            resolvedPrompt = resolvedPrompt.replace(regex, row[col] || '');
        });
        resolvedPrompt = resolvedPrompt.replace(/{bookTitle}/g, row.bookTitle);
        
        const cardHtml = `
            <div class="llm-story-card bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-slate-800 dark:text-slate-300">
                        【第 ${idx + 1} 幕 · ${step.name}】
                    </span>
                    <button onclick="generateSingleStoryline(${idx})" class="px-2.5 py-1 text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-purple-600 dark:hover:bg-purple-600 hover:text-white dark:hover:text-white rounded border border-slate-200 dark:border-slate-700 transition flex items-center gap-1">
                        <i data-lucide="refresh-cw" class="w-3 h-3 text-purple-500"></i>
                        <span>单独生成/补发该幕</span>
                    </button>
                </div>
                
                <div class="text-[10px] text-slate-400 font-mono bg-slate-100 dark:bg-slate-900/60 p-2 rounded border border-slate-200 dark:border-slate-800 leading-normal break-all select-text">
                    <span class="font-bold text-slate-500">画面提示词：</span>${resolvedPrompt}
                </div>
                
                <div class="space-y-1">
                    <label class="block text-[10px] text-slate-400 font-bold">本子剧情台词：</label>
                    <textarea oninput="updateLlmCaption(${idx}, this.value)" id="llm-caption-text-${idx}" rows="2" class="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-xs focus:outline-none text-slate-800 dark:text-slate-200 focus:border-purple-500 transition leading-normal" placeholder="请输入本幕剧本台词或等待 AI 生成...">${currentText}</textarea>
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
    if (!row) return;
    
    if (!row.captions) row.captions = {};
    if (!row.captions[tplId]) row.captions[tplId] = [];
    
    row.captions[tplId][stepIdx] = textVal;
    saveMatrixToStorage();
}

// Global batch states
let llmCancelRequested = false;

function addLlmLog(msg, colorClass = "text-slate-400") {
    const logs = document.getElementById('llm-progress-logs');
    if (!logs) return;
    const time = new Date().toLocaleTimeString();
    logs.insertAdjacentHTML('beforeend', `<div class="${colorClass}">[${time}] ${msg}</div>`);
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
        let pText = step.prompt;
        batchMatrix.columns.forEach(col => {
            const regex = new RegExp(`{${col}}`, 'g');
            pText = pText.replace(regex, row[col] || '');
        });
        pText = pText.replace(/{bookTitle}/g, row.bookTitle);
        return {
            name: step.name,
            prompt: pText
        };
    });
    
    if (!row.captions) row.captions = {};
    if (!row.captions[tplId]) row.captions[tplId] = [];
    
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
            const textVal = textEl ? textEl.value.trim() : (row.captions[tplId][k] || '');
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
                    row.captions[tplId][stepIdx] = cap;
                    
                    const txtArea = document.getElementById(`llm-caption-text-${stepIdx}`);
                    if (txtArea) {
                        txtArea.value = cap;
                    }
                });
                saveMatrixToStorage();
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
async function generateSingleStoryline(stepIdx) {
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
    
    const btn = event.currentTarget;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="w-3 h-3 animate-spin"></i> <span>正在生成...</span>`;
    
    // Grab all real-time text up to stepIdx
    const historyCaptions = [];
    for (let k = 0; k < stepIdx; k++) {
        const textEl = document.getElementById(`llm-caption-text-${k}`);
        const textVal = textEl ? textEl.value.trim() : (row.captions[tplId][k] || '');
        if (textVal) {
            historyCaptions.push(`【第 ${k + 1} 幕】：${textVal}`);
        }
    }
    const previousContext = historyCaptions.join('\n');
    
    const step = tpl.steps[stepIdx];
    let resolvedPrompt = step.prompt;
    batchMatrix.columns.forEach(col => {
        const regex = new RegExp(`{${col}}`, 'g');
        resolvedPrompt = resolvedPrompt.replace(regex, row[col] || '');
    });
    resolvedPrompt = resolvedPrompt.replace(/{bookTitle}/g, row.bookTitle);
    
    try {
        const result = await requestLlmContinuity(
            "", 
            resolvedPrompt,
            previousContext,
            stepIdx + 1,
            tpl.steps.length
        );
        
        if (result) {
            row.captions[tplId][stepIdx] = result;
            const txtArea = document.getElementById(`llm-caption-text-${stepIdx}`);
            if (txtArea) {
                txtArea.value = result;
            }
            saveMatrixToStorage();
        }
    } catch (err) {
        alert(`生成失败: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

// ==========================================
// AI 聊天精修 (Chatbox) 功能实现
// ==========================================

let chatSessions = [];
let activeChatSessionId = null;

function initChatSessions() {
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
    activeChatSessionId = chatSessions[0].id;
    saveChatSessions();
}

function saveChatSessions() {
    localStorage.setItem('comfy_comic_chat_sessions', JSON.stringify(chatSessions));
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

    modal.classList.remove('hidden');
    // 小小延迟增加缩放效果
    setTimeout(() => {
        modal.querySelector('.transform').classList.remove('scale-95');
    }, 50);

    initChatSessions();
    renderChatSessionsList();
    renderChatMessages();
    initLucide();
}

function closeChatRefinementModal() {
    const modal = document.getElementById('chat-refinement-modal');
    if (!modal) return;
    modal.querySelector('.transform').classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
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
    const session = chatSessions.find(s => s.id === activeChatSessionId);
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

        const bubble = document.createElement('div');
        bubble.className = `max-w-[75%] px-4 py-3 text-xs leading-relaxed break-words whitespace-pre-wrap ${isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}`;
        
        // 简易 Markdown 渲染
        let contentHtml = escapeHtml(msg.content || '');
        contentHtml = contentHtml
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code class="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-blue-500 font-mono font-semibold">$1</code>');
        
        bubble.innerHTML = contentHtml;

        // 双击删除消息重试（仅允许删除 user 消息和普通的 assistant 文本消息，绝对禁止删除 tool 或 assistant(tool_calls) 消息以防消息链断裂）
        const canDelete = (isUser || idx > 0) && msg.role !== 'tool' && !(msg.role === 'assistant' && msg.tool_calls);
        if (canDelete) {
            bubble.title = "双击删除此消息";
            bubble.ondblclick = () => {
                if (confirm("确定要删除这条消息吗？")) {
                    session.messages.splice(idx, 1);
                    saveChatSessions();
                    renderChatMessages();
                }
            };
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

    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) {
        sendBtn.disabled = !textarea.value.trim();
    }

    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
    }
}

function adjustTextareaHeight(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = (textarea.scrollHeight + 2) + 'px';
}

function appendChatThinkingBubble() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;

    const thinkingWrapper = document.createElement('div');
    thinkingWrapper.id = 'chat-thinking-bubble';
    thinkingWrapper.className = 'flex justify-start w-full items-start gap-2.5 my-2';
    thinkingWrapper.innerHTML = `
        <div class="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0 border border-purple-500/20">
            <i data-lucide="bot" class="w-4 h-4"></i>
        </div>
        <div class="chat-bubble-assistant max-w-[75%] px-4 py-3 text-xs leading-relaxed flex items-center gap-2">
            <span id="thinking-text" class="text-slate-500 dark:text-slate-400">AI 正在思考中...</span>
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
    
    const userText = inputEl.value.trim();
    if (!userText) return;
    
    // 清空输入框
    inputEl.value = '';
    sendBtn.disabled = true;
    adjustTextareaHeight(inputEl);

    // 获取当前会话
    const session = chatSessions.find(s => s.id === activeChatSessionId);
    if (!session) return;
    
    // 追加 user 消息
    session.messages.push({ role: 'user', content: userText });
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
            if (callDepth >= MAX_TOOL_CALL_DEPTH) {
                console.warn("[AI-Chat] 工具链连续调用达到深度上限，强行中止");
                session.messages.push({
                    role: 'assistant',
                    content: "⚠️ 提示：AI 工具连续调用次数已达到安全阈值限制（5次），为避免死循环，处理已强行中止。请检查大纲或分镜格式是否符合要求。"
                });
                finished = true;
                break;
            }

            responseMessage = await requestLlmChatWithTools(session.messages);
            
            // 将 AI 的响应追加到消息流中
            session.messages.push({
                role: 'assistant',
                content: responseMessage.content || '',
                tool_calls: responseMessage.tool_calls || undefined
            });
            
            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                callDepth++;
                // 更新 Thinking 气泡为“正在执行工具修改...”
                updateChatThinkingBubbleText(`AI 正在执行工具修改中 (${callDepth}/${MAX_TOOL_CALL_DEPTH})...`);
                
                // 执行工具调用链
                const toolResults = await handleToolCallsChain(responseMessage.tool_calls);
                
                // 将工具调用的执行结果追加到消息流中
                session.messages.push(...toolResults);
                
                // 刷新消息界面，展示调用动作
                renderChatMessages();
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
        console.error("AI 聊天助手遇到错误:", err);
        session.messages.push({
            role: 'assistant',
            content: `❌ 精修请求失败: ${err.message}`
        });
        renderChatMessages();
        saveChatSessions();
    } finally {
        sendBtn.disabled = false;
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
    
    // 检查必需的占位符 {character} 与 {style}
    if (!prompt.includes('{character}')) {
        return { valid: false, error: "提示词中缺少核心主角变量占位符 '{character}'" };
    }
    if (!prompt.includes('{style}')) {
        return { valid: false, error: "提示词中缺少画风占位符 '{style}'" };
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
            return { success: false, error: `占位符校验未通过: ${val.error}。请重新润色提示词并包含核心占位符变量。` };
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
        return { success: false, error: `占位符校验未通过: ${val.error}。请确保新建分镜提示词里包含必需的占位符。` };
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