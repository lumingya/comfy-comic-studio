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

// 2. 带有 AbortController 超时机制的高可靠性 fetch 封装
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 10000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        if (err.name === 'AbortError') {
            throw new Error(`连接请求超时，限制为 ${timeout}ms`);
        }
        throw err;
    }
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
    const maxAttempts = 120; // 2 minutes timeout
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
                    const outputs = hData[promptId].outputs;
                    if (outputs && outputs[outNodeId] && outputs[outNodeId].images) {
                        const imgInfo = outputs[outNodeId].images[0];
                        const filename = imgInfo.filename;
                        const subfolder = imgInfo.subfolder || "";
                        const type = imgInfo.type || "output";
                        
                        outImgUrl = `${baseUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`;
                        completed = true;
                    } else {
                        throw new Error("图像生成已完成，但在指定的输出节点中找不到渲染完的图像。请确认输出节点ID配置正确。");
                    }
                }
            }
        } catch (err) {
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
        const saveRes = await fetchWithTimeout('http://127.0.0.1:8777/api/save-image', {
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

// Mock prompt-based aesthetic image selector
function getMockVisual(styleString, stepIndex) {
    // High quality concept/illustration graphics
    const nature = [
        "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&q=80&w=600"
    ];
    const anime = [
        "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1614036417651-efe5912149d8?auto=format&fit=crop&q=80&w=600",
        "https://images.unsplash.com/photo-1560942485-b2a11cc13456?auto=format&fit=crop&q=80&w=600"
    ];
    
    if (styleString.toLowerCase().includes('anime') || styleString.toLowerCase().includes('cartoon')) {
        return anime[stepIndex % anime.length];
    }
    return nature[stepIndex % nature.length];
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
