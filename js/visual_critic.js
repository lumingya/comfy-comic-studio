// js/visual_critic.js - 多模态视觉“审校 Agent”（Visual Critic & Auto-Fix）
// 调用本地 Ollama (MiniCPM-V/Qwen-VL) 或云端 Vision API 对画面进行质量、一致性与肢体结构审查。

const VisualCritic = {
    /**
     * 获取视觉模型配置
     */
    getConfig() {
        const baseUrlEl = document.getElementById('llm-base-url');
        const apiKeyEl = document.getElementById('llm-api-key');
        const modelEl = document.getElementById('llm-model-name');

        const baseUrl = baseUrlEl ? baseUrlEl.value.trim() : 'http://localhost:11434/v1';
        const apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
        // 优先使用用户选定的视觉模型或通用模型
        let model = modelEl ? modelEl.value.trim() : 'gpt-4o';
        if (!model) model = 'gpt-4o';

        return { baseUrl, apiKey, model };
    },

    /**
     * 对单帧画面发起视觉审校
     */
    /**
     * 将图片转换为适合多模态审查的紧凑 Base64 格式（限制长边 1280px，降低网络载荷并规避 413 限制）
     * 关键修复：SVG 矢量图或超大 PNG 强制通过 Canvas 光栅化转为标准 JPEG 0.85，防止大模型接口返回 400 Bad Request
     */
    async prepareImageForAudit(src) {
        const toBase64 = (typeof window !== 'undefined' && window.imageSourceToBase64DataUrl)
            ? window.imageSourceToBase64DataUrl
            : (typeof imageSourceToBase64DataUrl === 'function' ? imageSourceToBase64DataUrl : async s => s);
        const rawDataUrl = await toBase64(src);
        if (!rawDataUrl || typeof document === 'undefined') return rawDataUrl;

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const maxDim = 1280;
                let width = img.width || 512;
                let height = img.height || 512;
                const isJpeg = typeof rawDataUrl === 'string' && rawDataUrl.startsWith('data:image/jpeg');

                // 只有已经是标准 JPEG 且分辨率合规时才允许短路；SVG 矢量图与超大图必须光栅化转码
                if (isJpeg && width <= maxDim && height <= maxDim) {
                    resolve(rawDataUrl);
                    return;
                }

                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                // 白色背景铺底，防止带透明通道的 PNG/SVG 转 JPEG 出现纯黑底色
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = () => resolve(rawDataUrl);
            img.src = rawDataUrl;
        });
    },

    /**
     * 对单帧画面发起视觉审校（支持超时与 AbortSignal）
     */
    async auditPanel(book, stepIndex, externalSignal = null) {
        if (!book || !Array.isArray(book.steps) || !book.steps[stepIndex]) {
            throw new Error("分镜数据不存在");
        }

        const step = book.steps[stepIndex];
        if (!step.image) {
            throw new Error("该分镜尚未生成图片，无法审校");
        }

        // 捕获请求时的图片快照，防止用户在长耗时请求期间重绘画面产生时序覆盖（Stale Overwrite）
        const targetImageSrc = step.image;
        const { baseUrl, apiKey, model } = this.getConfig();
        const imageDataUrl = await this.prepareImageForAudit(step.image);

        const promptText = `
请仔细审查这一张连环画分镜的生成质量：
【画册主线】${book.title || '未知故事'}
【主角设定】${book.characterName || '未指定'}
【分镜名称】${step.name || `第 ${stepIndex + 1} 幕`}
【画面提示词】${step.prompt || ''}
【分镜剧情旁白】${step.caption || ''}

请重点判断：
1. 角色发型、服装等特征是否符合设定？
2. 是否存在多肢、坏手、面部崩坏或明显几何畸变？
3. 景别和动作是否契合提示词和剧情？
4. 如果画面不理想，应在负面提示词或重绘提示词中补充哪些修正？
`;

        // 60 秒超时与取消中断防御（与服务端保持拉齐）
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(new Error("视觉审校网络请求超时（60秒）")), 60000);
        if (externalSignal) {
            externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason));
        }

        try {
            const resp = await fetch(getLocalBackendUrl('/api/vision/audit'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    baseUrl,
                    apiKey,
                    model,
                    promptText,
                    imageDataUrl
                }),
                signal: controller.signal
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${resp.status}`);
            }

            const resData = await resp.json();
            const critique = resData.critique || {};

            // 关键防御：如果等待期间分镜图片已发生改变或画册任务已被取消，丢弃旧审查结果并返回 null
            if (step.image !== targetImageSrc || book.status === 'canceled') {
                console.warn(`[VisualCritic] 分镜 ${stepIndex + 1} 在审校期间图片已被替换或任务已取消，丢弃过期审校结果。`);
                return null;
            }

            // 缓存到步骤数据中
            step.critique = {
                ...critique,
                auditedAt: new Date().toISOString(),
                modelUsed: model
            };

            // 触发本地保存
            saveGalleriesToStorage();
            return step.critique;
        } finally {
            clearTimeout(timeoutId);
        }
    }
};

window.VisualCritic = VisualCritic;

/**
 * 在画廊阅读器中手动触发当前分镜的 AI 审校
 */
async function auditCurrentReaderStep() {
    const book = savedGalleries.find(b => b.id === activeBookId);
    if (!book) return;

    const stepIdx = (typeof window.currentReaderStepIndex !== 'undefined' ? window.currentReaderStepIndex : 0);
    const btn = document.getElementById('btn-audit-current-step');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> 审校中...`;
        initLucide(btn);
    }

    try {
        const infoFn = typeof notifyInfo === 'function' ? notifyInfo : (typeof window.notifyInfo === 'function' ? window.notifyInfo : notify);
        infoFn("正在调用多模态视觉 Agent 审查画面...", 3000);
        const critique = await VisualCritic.auditPanel(book, stepIdx);
        renderReaderStepCritique(critique);
        const successFn = typeof notifySuccess === 'function' ? notifySuccess : (typeof window.notifySuccess === 'function' ? window.notifySuccess : notify);
        successFn(`视觉审校完成！得分：${critique.score || 8}/10`);
    } catch (err) {
        const errorFn = typeof notifyError === 'function' ? notifyError : (typeof window.notifyError === 'function' ? window.notifyError : notify);
        errorFn(`审校失败：${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
            initLucide(btn);
        }
    }
}

/**
 * 渲染阅读器中的审校结果卡片
 */
function renderReaderStepCritique(critique) {
    const container = document.getElementById('step-critique-container');
    if (!container) return;

    if (!critique) {
        container.innerHTML = `
            <div class="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center">
                <p class="text-xs text-slate-400">尚未进行 AI 视觉审校</p>
                <button type="button" id="btn-audit-current-step" onclick="auditCurrentReaderStep()" class="mt-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 mx-auto transition">
                    <i data-lucide="scan-eye" class="w-3.5 h-3.5"></i> 开始 AI 审校
                </button>
            </div>
        `;
        initLucide(container);
        return;
    }

    const score = (typeof critique.score === 'number' && !isNaN(critique.score))
        ? critique.score
        : (!isNaN(Number(critique.score)) && critique.score !== null && critique.score !== '' ? Number(critique.score) : 7);
    const isPassed = (String(critique.passed).toLowerCase() === 'true' || critique.passed === true) && score >= 7;
    const scoreBadgeClass = isPassed
        ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
        : "bg-amber-500/10 text-amber-500 border-amber-500/30";

    container.innerHTML = `
        <div class="p-3.5 bg-slate-50 dark:bg-slate-900/80 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                    <i data-lucide="shield-check" class="w-4 h-4 text-purple-500"></i>
                    <span class="text-xs font-bold text-slate-700 dark:text-slate-200">AI 视觉审校报告</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${scoreBadgeClass}">
                        ${score} / 10 分 · ${isPassed ? '通过' : '建议调整'}
                    </span>
                    <button type="button" id="btn-audit-current-step" onclick="auditCurrentReaderStep()" class="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md text-slate-400" title="重新审校">
                        <i data-lucide="refresh-cw" class="w-3 h-3"></i>
                    </button>
                </div>
            </div>

            <p class="text-xs font-medium text-slate-800 dark:text-slate-200 leading-relaxed bg-white dark:bg-slate-950 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60">
                “${escapeHtml(critique.summary || '画面基本符合剧本设定。')}”
            </p>

            <div class="grid grid-cols-2 gap-2 text-[11px]">
                <div class="p-2 bg-slate-100 dark:bg-slate-950 rounded-lg">
                    <span class="text-slate-400 font-semibold block mb-0.5">解剖与肢体</span>
                    <span class="text-slate-600 dark:text-slate-300">${escapeHtml(critique.anatomy || '无明显异常')}</span>
                </div>
                <div class="p-2 bg-slate-100 dark:bg-slate-950 rounded-lg">
                    <span class="text-slate-400 font-semibold block mb-0.5">角色一致性</span>
                    <span class="text-slate-600 dark:text-slate-300">${escapeHtml(critique.consistency || '特征符合')}</span>
                </div>
            </div>

            ${critique.suggestions && critique.suggestions !== '无' ? `
                <div class="p-2.5 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2">
                    <i data-lucide="wrench" class="w-4 h-4 text-amber-500 shrink-0 mt-0.5"></i>
                    <div class="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed flex-grow">
                        <strong>修复建议：</strong>${escapeHtml(critique.suggestions)}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    initLucide(container);
}

window.auditCurrentReaderStep = auditCurrentReaderStep;
window.renderReaderStepCritique = renderReaderStepCritique;
