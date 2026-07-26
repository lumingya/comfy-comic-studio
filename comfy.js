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
        badge.className = "flex items-center space-x-1.5 px-3 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full text-xs font-semibold";
        text.innerText = "模拟引擎启动中";
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
            if (!silent) alert("连接成功！ComfyUI 实例处于在线状态。");
        } else {
            throw new Error("HTTP Status " + res.status);
        }
    } catch (err) {
        badge.className = "flex items-center space-x-1.5 px-3 py-1 bg-red-500/10 text-red-500 border border-red-500/20 rounded-full text-xs font-semibold";
        text.innerText = "ComfyUI 未连通";
        if (!silent) {
            alert(`连接失败。\n1. 请检查 ComfyUI 是否正常运行在 ${url}\n2. 这是典型的浏览器 CORS 跨域安全阻拦。\n请确保在启动器中勾选了“允许跨域 / 开启 CORS”，或者在 ComfyUI 启动命令行里添加了参数 --enable-cors-header 并重启了 ComfyUI。`);
        }
    }
}

// Toggle engine mode between Mock Mode and Production Mode
function toggleEngineMode(notify = true) {
    const toggle = document.getElementById('engine-mock-toggle');
    if (!toggle) {
        isMockMode = false;
        return;
    }
    isMockMode = toggle.checked;
    localStorage.setItem('comfy_is_mock', isMockMode);
    if (typeof window.saveComfyConfigFromDom === 'function') {
        window.saveComfyConfigFromDom();
    }
    
    const tip = document.getElementById('engine-mode-tip');
    if (isMockMode) {
        if (tip) tip.innerText = "当前开启“模拟模式”：不连接外部 ComfyUI 或 LLM 服务，生成高度真实的画集和情景，用于调试系统全生命流程。";
        if (notify) alert("已切换至：模拟模式（无需部署即可体验连环画批量生成）");
    } else {
        if (tip) tip.innerText = "当前开启“生产模式”：系统会真枪实弹向您本地的 ComfyUI 以及 LLM API 发送真实请求，请确保相关服务已开启。";
        if (notify) alert("已切换至：生产模式。请确保 ComfyUI 及大模型 API 均已开启并配置正确！");
    }
    testComfyConnection(true);
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
