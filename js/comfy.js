// comfy.js - ComfyUI 图像渲染连接中枢

// Helper to pause execution asynchronously
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 1. 显式定义批量任务取消专用错误类型
class BatchCancelError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BatchCancelError';
    }
}

class ComfyWorkflowError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ComfyWorkflowError';
    }
}

// 2. 带有 AbortController 超时机制的高可靠性 fetch 封装
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 10000, signal: externalSignal, ...fetchOptions } = options;
    const controller = new AbortController();
    let timedOut = false;
    const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
        abortFromExternalSignal();
    } else {
        externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
    }
    const id = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeout);
    try {
        const response = await fetch(resource, {
            ...fetchOptions,
            signal: controller.signal
        });
        return response;
    } catch (err) {
        if (err.name === 'AbortError' && timedOut) {
            throw new Error(`连接请求超时，限制为 ${timeout}ms`);
        }
        throw err;
    } finally {
        clearTimeout(id);
        externalSignal?.removeEventListener('abort', abortFromExternalSignal);
    }
}

const COMFY_SEED_MAX = Number.MAX_SAFE_INTEGER;

function generateComfySeed() {
    const cryptoObj = (typeof window !== 'undefined' && window.crypto) || (typeof globalThis !== 'undefined' && globalThis.crypto);
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
        const values = new Uint32Array(2);
        cryptoObj.getRandomValues(values);
        const seed = (values[0] * 0x200000) + (values[1] >>> 11);
        return seed > 0 ? seed : 1;
    }
    return Math.max(1, Math.floor(Math.random() * COMFY_SEED_MAX));
}

function isComfyNodeLink(value) {
    return Array.isArray(value)
        && value.length >= 2
        && (typeof value[0] === 'string' || typeof value[0] === 'number')
        && typeof value[1] === 'number';
}

function isSeedInputName(inputName) {
    return String(inputName || '').toLowerCase().includes('seed');
}

function isNumericSeedString(value) {
    return typeof value === 'string' && /^\d+$/.test(value.trim());
}

function randomizeComfyWorkflowSeeds(workflow) {
    const changes = [];
    const touchedInputs = new Set();
    const nodeSeeds = new Map();
    const linkedSeedSourceNodeIds = new Set();

    if (!workflow || typeof workflow !== 'object') return changes;

    const getSeedForNode = (nodeId) => {
        const id = String(nodeId);
        if (!nodeSeeds.has(id)) nodeSeeds.set(id, generateComfySeed());
        return nodeSeeds.get(id);
    };

    const setSeedInput = (nodeId, node, key, asString = false) => {
        if (!node || !node.inputs) return false;
        const marker = `${nodeId}.${key}`;
        if (touchedInputs.has(marker)) return false;

        const seed = getSeedForNode(nodeId);
        node.inputs[key] = asString ? String(seed) : seed;
        touchedInputs.add(marker);
        changes.push({ nodeId: String(nodeId), key, seed });
        return true;
    };

    const entries = Object.entries(workflow);
    entries.forEach(([nodeId, node]) => {
        if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') return;

        Object.entries(node.inputs).forEach(([key, value]) => {
            if (!isSeedInputName(key)) return;

            if (typeof value === 'number' && Number.isFinite(value)) {
                setSeedInput(nodeId, node, key);
            } else if (isNumericSeedString(value)) {
                setSeedInput(nodeId, node, key, true);
            } else if (isComfyNodeLink(value)) {
                linkedSeedSourceNodeIds.add(String(value[0]));
            }
        });
    });

    linkedSeedSourceNodeIds.forEach((sourceNodeId) => {
        const sourceNode = workflow[sourceNodeId];
        if (!sourceNode || typeof sourceNode !== 'object' || !sourceNode.inputs || typeof sourceNode.inputs !== 'object') return;

        let updatedSource = false;
        Object.entries(sourceNode.inputs).forEach(([key, value]) => {
            if (!isSeedInputName(key)) return;

            if (typeof value === 'number' && Number.isFinite(value)) {
                updatedSource = setSeedInput(sourceNodeId, sourceNode, key) || updatedSource;
            } else if (isNumericSeedString(value)) {
                updatedSource = setSeedInput(sourceNodeId, sourceNode, key, true) || updatedSource;
            }
        });

        if (!updatedSource && typeof sourceNode.inputs.value === 'number' && Number.isFinite(sourceNode.inputs.value)) {
            setSeedInput(sourceNodeId, sourceNode, 'value');
        } else if (!updatedSource && isNumericSeedString(sourceNode.inputs.value)) {
            setSeedInput(sourceNodeId, sourceNode, 'value', true);
        }
    });

    entries.forEach(([nodeId, node]) => {
        if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') return;
        const classType = String(node.class_type || '').toLowerCase();
        const title = String(node._meta?.title || '').toLowerCase();
        if (!classType.includes('seed') && !title.includes('seed') && !title.includes('随机种')) return;

        if (typeof node.inputs.value === 'number' && Number.isFinite(node.inputs.value)) {
            setSeedInput(nodeId, node, 'value');
        } else if (isNumericSeedString(node.inputs.value)) {
            setSeedInput(nodeId, node, 'value', true);
        }
    });

    return changes;
}

// Test local comfy Connection (supporting cors and system_stats check)
async function testComfyConnection(silent = false) {
    const badge = document.getElementById('comfy-status-badge');
    const text = document.getElementById('comfy-status-text');

    if (isMockMode) {
        if (badge) badge.className = "flex items-center space-x-1.5 px-3 py-1 bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400 border border-amber-500/20 rounded-full text-xs font-semibold";
        if (text) text.innerText = "模拟模式运行中";
        return;
    }

    const url = document.getElementById('comfy-url-input').value.trim();
    localStorage.setItem('comfy_api_url', url);
    if (typeof window.saveComfyConfigFromDom === 'function') {
        window.saveComfyConfigFromDom();
    }

    try {
        // Test endpoint /system_stats
        const res = await fetchWithTimeout(`${url}/system_stats`, { mode: 'cors', timeout: 5000 });
        if (res.ok) {
            badge.className = "flex items-center space-x-1.5 px-3 py-1 bg-emerald-600/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-semibold";
            text.innerText = "ComfyUI 已连接";
            if (!silent) notify("ComfyUI 实例在线，连接正常。", { type: "success" });
        } else {
            throw new Error("HTTP Status " + res.status);
        }
    } catch (err) {
        badge.className = "flex items-center space-x-1.5 px-3 py-1 bg-red-500/10 text-red-500 border border-red-500/20 rounded-full text-xs font-semibold";
        text.innerText = "ComfyUI 未连通";
        if (!silent) {
            notifyError(`连不上 ${url}。\n1) 确认 ComfyUI 正在运行；\n2) 多半是浏览器 CORS 拦截：在启动器里勾选“允许跨域”，或给 ComfyUI 加上 --enable-cors-header 后重启。`, { title: "ComfyUI 连接失败", duration: 12000 });
        }
    }
}

const MOCK_MODE_TIP = '模拟模式：不连接 ComfyUI 或大模型，用本地生成的矢量画面和示例剧情跑通整条流程。'
    + '适合还没装好 ComfyUI，或者只想先看看模板与批量流程长什么样的时候。';
const PRODUCTION_MODE_TIP = '生产模式：向本地 ComfyUI 和你配置的大模型 API 发送真实请求。请先确认两边服务都已启动，地址与密钥都填对了。';

// 在模拟 / 生产模式之间切换。
// 形参不能命名为 notify —— 那会遮蔽全局的 notify() 提示函数。
function toggleEngineMode(announce = true) {
    const toggle = document.getElementById('engine-mock-toggle');
    if (!toggle) {
        isMockMode = false;
        return;
    }
    isMockMode = toggle.checked;
    localStorage.setItem('comfy_is_mock', String(isMockMode));
    if (typeof window.saveComfyConfigFromDom === 'function') {
        window.saveComfyConfigFromDom();
    }

    renderEngineModeUi();

    if (announce) {
        if (isMockMode) {
            notify('已切换到模拟模式：无需部署 ComfyUI 也能跑完整个批量流程。', { type: 'warning', title: '模拟模式' });
        } else {
            notify('已切换到生产模式：请确认 ComfyUI 与大模型 API 都已就绪。', { type: 'info', title: '生产模式' });
        }
    }
    testComfyConnection(true);
}

// 把当前运行模式同步到「运行模式」说明文字、开关状态与顶栏徽标。
function renderEngineModeUi() {
    const tip = document.getElementById('engine-mode-tip');
    if (tip) tip.innerText = isMockMode ? MOCK_MODE_TIP : PRODUCTION_MODE_TIP;

    const toggle = document.getElementById('engine-mock-toggle');
    if (toggle) toggle.checked = !!isMockMode;

    if (isMockMode) testComfyConnection(true);
}

// Real Real-world ComfyUI Web API fetch logic
async function submitToRealComfy(positivePromptText) {
    const baseUrl = document.getElementById('comfy-url-input').value.trim();
    const posNodeId = document.getElementById('node-id-positive').value.trim();
    const negNodeId = document.getElementById('node-id-negative').value.trim();
    const outNodeId = document.getElementById('node-id-output').value.trim();

    // Clone our JSON template
    const workflowPayload = JSON.parse(JSON.stringify(comfyWorkflowRaw));
    const seedChanges = randomizeComfyWorkflowSeeds(workflowPayload);
    if (seedChanges.length > 0) {
        addLog(`已刷新 ${seedChanges.length} 个 ComfyUI Seed，本次主 Seed: ${seedChanges[0].seed}`, "text-emerald-400");
        console.log('[ComfyUI] Randomized seed inputs:', seedChanges);
    } else {
        addLog("未在当前工作流中发现可自动刷新的 Seed 字段，将沿用工作流原始设置。", "text-amber-400");
    }

    // Inject modified positive text
    if (workflowPayload[posNodeId]) {
        const node = workflowPayload[posNodeId];
        if (!node.inputs) node.inputs = {};
        
        // Fully compatible with SillyTavern Simplification allowed list and SDXL/Advanced custom nodes
        const textKeys = ["text", "opt_text", "string", "text_positive", "positive", "prompt", "wildcard_text", "text_g", "text_l", "value", "Text", "String", "Value"];
        let replaced = false;

        // 1. Match typical keys
        for (const key of textKeys) {
            if (key in node.inputs && typeof node.inputs[key] === 'string') {
                node.inputs[key] = positivePromptText;
                replaced = true;
                console.log(`Successfully injected positive prompt to node ${posNodeId} property [${key}].`);
            }
        }

        // 2. Scan for any string properties
        if (!replaced) {
            const stringKeys = Object.keys(node.inputs).filter(k => typeof node.inputs[k] === 'string');
            if (stringKeys.length > 0) {
                stringKeys.forEach(k => {
                    node.inputs[k] = positivePromptText;
                });
                replaced = true;
                console.log(`Successfully injected positive prompt to node ${posNodeId} detected string-keys [${stringKeys.join(', ')}].`);
            }
        }

        // 3. Ultimate Fallback
        if (!replaced) {
            node.inputs.text = positivePromptText;
            console.log(`Fallback: Force-injected positive prompt 'text' key to node ${posNodeId}.`);
        }
    } else {
        throw new Error(`找不到配置的积极提示词节点ID: ${posNodeId}`);
    }

    // (Optional) Inject Negative prompt text
    const negPrompt = "easynegative, worst quality, low quality, duplicate, bad eyes, bad hands";
    if (negNodeId && workflowPayload[negNodeId]) {
        const node = workflowPayload[negNodeId];
        if (!node.inputs) node.inputs = {};
        
        const textKeys = ["text", "opt_text", "string", "text_positive", "positive", "prompt", "wildcard_text", "text_g", "text_l", "value", "Text", "String", "Value"];
        let replaced = false;

        for (const key of textKeys) {
            if (key in node.inputs && typeof node.inputs[key] === 'string') {
                node.inputs[key] = negPrompt;
                replaced = true;
            }
        }

        if (!replaced) {
            const stringKeys = Object.keys(node.inputs).filter(k => typeof node.inputs[k] === 'string');
            if (stringKeys.length > 0) {
                stringKeys.forEach(k => {
                    node.inputs[k] = negPrompt;
                });
                replaced = true;
            }
        }

        if (!replaced) {
            node.inputs.text = negPrompt;
        }
    }

    // Create submission package
    const client_id = "comfy_comic_studio_client_" + Math.random().toString(36).substring(7);
    const body = {
        prompt: workflowPayload,
        client_id: client_id
    };

    // Post Prompt Queue to ComfyUI
    const qRes = await fetchWithTimeout(`${baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeout: 10000 // 10秒连接队列超时限制
    });

    if (!qRes.ok) {
        const errTxt = await qRes.text();
        throw new Error(`ComfyUI Queueing Failed: ${errTxt}`);
    }

    const qData = await qRes.json();
    const promptId = qData.prompt_id;
    addLog(`任务已进入 ComfyUI 队列，Prompt ID: ${promptId}。开始轮询结果...`);

    // Start polling history for completion
    let completed = false;
    let checkAttempts = 0;
    const maxAttempts = 120; // 4 minutes timeout at a 2-second polling interval
    let outImgUrl = "";

    while (!completed && checkAttempts < maxAttempts) {
        if (cancelRequested) {
            throw new BatchCancelError("User canceled execution queue.");
        }

        await sleep(2000); // Poll every 2 seconds
        checkAttempts++;

        try {
            const hRes = await fetchWithTimeout(`${baseUrl}/history/${promptId}`, { timeout: 10000 });
            if (hRes.ok) {
                const hData = await hRes.json();
                if (hData[promptId]) {
                    // Prompt completed! Let's parse output
                    const historyEntry = hData[promptId];
                    const statusMessages = Array.isArray(historyEntry.status?.messages)
                        ? historyEntry.status.messages.map(item => Array.isArray(item) ? item.join(': ') : String(item)).join('; ')
                        : '';
                    if (historyEntry.status?.status_str === 'error') {
                        throw new ComfyWorkflowError(`ComfyUI 工作流执行失败${statusMessages ? `：${statusMessages}` : '，请查看 ComfyUI 控制台日志。'}`);
                    }

                    const outputs = historyEntry.outputs;
                    if (outputs && outputs[outNodeId] && Array.isArray(outputs[outNodeId].images) && outputs[outNodeId].images.length > 0) {
                        const imgInfo = outputs[outNodeId].images[0];
                        const filename = imgInfo.filename;
                        const subfolder = imgInfo.subfolder || "";
                        const type = imgInfo.type || "output";
                        
                        outImgUrl = `${baseUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
                        completed = true;
                    } else {
                        throw new ComfyWorkflowError(`图像生成已完成，但输出节点 ${outNodeId || '（未配置）'} 中没有可用图像。请检查输出节点 ID。`);
                    }
                }
            }
        } catch (err) {
            if (err instanceof ComfyWorkflowError || err instanceof BatchCancelError) {
                throw err;
            }
            console.warn(`[History Polling Attempt ${checkAttempts} Failed]: ${err.message}`);
            // 局部偶发性的通信瞬断允许自动重试直到 maxAttempts，不立即崩溃；但如果是用户主动取消，则直接重抛中断
            if (cancelRequested) {
                throw new BatchCancelError("User canceled execution queue.");
            }
        }
    }

    if (!completed) {
        throw new Error("生图队列执行超时，请确保 ComfyUI 控制台没有发生报错卡死。");
    }

    // 持久化图片到本地 images/ 目录，防止 ComfyUI 重启后 temp 文件失效
    try {
        const saveRes = await fetchWithTimeout(getLocalBackendUrl('/api/save-image'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: outImgUrl }),
            timeout: 35000
        });
        if (saveRes.ok) {
            const saveData = await saveRes.json();
            if (saveData.localUrl) {
                console.log(`[ImageStore] 图片已持久化至本地: ${saveData.localUrl}`);
                outImgUrl = saveData.localUrl; // 替换为本地永久 URL
            }
        }
    } catch (err) {
        console.warn('[ImageStore] 图片持久化失败，使用原始 ComfyUI URL（重启后可能失效）:', err.message);
    }

    return outImgUrl;
}

// 模拟模式的占位画面：完全在本地用 SVG 生成，不请求任何外网图床。
// 同样的 (风格, 幕序号, 标签) 组合永远产出同一张图，便于复现调试。
function getMockVisual(styleString, stepIndex, label = '') {
    const seed = `${String(styleString || 'default')}#${stepIndex}`;
    if (typeof window.makeLocalArtPlaceholder === 'function') {
        return window.makeLocalArtPlaceholder(seed, label || `第 ${stepIndex + 1} 幕`);
    }
    return window.OFFLINE_PLACEHOLDER_IMAGE || '';
}

// Physically send interrupt command to ComfyUI backend server (instantly stops KSampler and clears queue)
async function interruptComfy() {
    const baseUrl = document.getElementById('comfy-url-input').value.trim();
    
    // 1. Clear waiting queue
    try {
        const response = await fetchWithTimeout(`${baseUrl}/queue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clear: true }),
            timeout: 5000 // 5秒超时限制，防止打断动作也因断网无限挂起
        });
        if (response.ok) {
            console.log('[ComfyUI] Successfully cleared all pending queue requests.');
        }
    } catch (err) {
        console.warn('[ComfyUI] Error clearing pending queue: ', err.message);
    }

    // 2. Interrupt current active KSampler drawing
    try {
        const response = await fetchWithTimeout(`${baseUrl}/interrupt`, {
            method: 'POST',
            timeout: 5000 // 5秒超时限制
        });
        if (response.ok) {
            console.log('[ComfyUI] Successfully sent physical /interrupt request to cancel current drawing.');
        }
    } catch (err) {
        console.warn('[ComfyUI] Error sending interrupt request: ', err.message);
    }
}
