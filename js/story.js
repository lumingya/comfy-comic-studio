// js/story.js - LLM 剧情引擎：分批生成、逐幕微调、XML 模板设计。

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
        notifyWarning("请先填写 LLM API Key。");
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
        notify("LLM 服务连接成功，配置已落盘。", { type: "success" });
    } catch (err) {
        notifyError(`LLM 服务连接失败：${err.message}`);
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
        notifyWarning("请先填写题材大纲要求描述。");
        return;
    }
    if (!apiConfig.apiKey) {
        notifyWarning("请先配置可用的 API Key。");
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
        notifyError(`XML 模板生成失败：${err.message}`);
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
        notifyWarning("还没有可保存的 XML 内容。");
        return;
    }

    try {
        const tpl = parseXmlTemplateText(xmlText);
        templates.unshift(tpl);
        activeTemplateId = tpl.id;
        saveTemplatesToStorage();
        renderTemplatesList();
        populateTemplateDropdowns();
        notify(`已保存模板「${tpl.title}」，共 ${tpl.steps.length} 幕。`, { type: "success" });
    } catch (err) {
        notifyError(`保存 XML 模板失败：${err.message}`);
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
        notifyWarning("请先选择角色和模板。");
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
        notifyWarning("请先选择要生成剧情的角色和模板。");
        return;
    }
    
    const row = batchMatrix.rows.find(r => r.id === rowId);
    const tpl = templates.find(t => t.id === tplId);
    
    if (!row || !tpl) return;
    
    const apiKey = document.getElementById('llm-api-key').value.trim();
    if (!apiKey) {
        notifyWarning("请先配置 LLM API Key。");
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
    const globalOutline = resolveGlobalStoryOutline(tpl);
    addLlmLog(globalOutline
        ? `已带上主线大纲（${globalOutline.length} 字）参与生成。`
        : '未填写主线大纲，模板简介也是空的：本次生成缺少全局上下文，剧情连贯性会变差。',
        globalOutline ? 'text-slate-400' : 'text-amber-400');

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
                globalOutline,
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
        notify("剧情已全部生成完毕。", { type: "success" });
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
        notifyWarning("请先配置 LLM API Key。");
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
            resolveGlobalStoryOutline(tpl),
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
        notifyError(`生成失败：${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            initLucide(btn);
        }
    }
}
