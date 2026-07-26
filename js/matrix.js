// js/matrix.js - 批量角色矩阵、变量列管理与剧本旁白编辑弹窗。

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
