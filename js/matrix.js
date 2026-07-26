// js/matrix.js - 批量角色矩阵、变量列管理与剧本旁白编辑弹窗。

// --- TAB 3: BATCH MATRIX ---
// 矩阵表头：列名、列说明，以及重命名 / 删除该列的入口。
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
        return { label: '画风', className: 'text-indigo-400', minWidthClass: 'min-w-[120px]' };
    }
    if (lower === 'outfit') {
        return { label: '服装/造型', className: 'text-pink-400', minWidthClass: 'min-w-[120px]' };
    }
    return { label: '自定义变量', className: 'text-purple-400', minWidthClass: 'min-w-[120px]' };
}

function renderMatrixTableHeader() {
    const headerRow = document.getElementById('matrix-header-row');
    if (!headerRow) return;

    const variableHeaders = batchMatrix.columns.map(col => {
        const meta = getMatrixColumnHeaderMeta(col);
        const isCore = DEFAULT_MATRIX_COLUMNS.includes(col);
        const deleteBtn = isCore ? '' : `<button type="button" onclick="deleteMatrixColumn(${inlineJsString(col)})" class="step-tool-btn is-danger" title="删除 {${escapeHtml(col)}} 这一列" aria-label="删除变量 ${escapeHtml(col)}"><i data-lucide="trash-2" class="w-3 h-3"></i></button>`;
        return `
            <th class="p-3 ${meta.minWidthClass} ${meta.className} font-mono align-top">
                <div class="flex items-start justify-between gap-1">
                    <div class="min-w-0">
                        <div class="truncate">{${escapeHtml(col)}}</div>
                        <div class="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500 font-semibold">${escapeHtml(meta.label)}</div>
                    </div>
                    <div class="flex items-center gap-0.5 shrink-0">
                        <button type="button" onclick="renameMatrixColumn(${inlineJsString(col)})" class="step-tool-btn" title="重命名 {${escapeHtml(col)}}（会同步改写所有模板里的占位符）" aria-label="重命名变量 ${escapeHtml(col)}">
                            <i data-lucide="pencil" class="w-3 h-3"></i>
                        </button>
                        ${deleteBtn}
                    </div>
                </div>
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

async function deleteMatrixRow(rIdx) {
    const row = batchMatrix.rows[rIdx];
    if (!row) return;

    // 一行角色带着它全部的剧情版本，误删代价很高，必须显式确认。
    const storyCount = Object.values(row.storyVersions || {})
        .reduce((total, versions) => total + (Array.isArray(versions) ? versions.length : 0), 0);
    const confirmed = await confirmAction({
        title: '删除这一行角色？',
        message: storyCount > 0
            ? `「${row.bookTitle || '未命名角色'}」以及它保存的 ${storyCount} 份剧情版本会一并删除，无法撤销。`
            : `「${row.bookTitle || '未命名角色'}」会被删除，无法撤销。`,
        confirmText: '删除该行',
        danger: true
    });
    if (!confirmed) return;

    batchMatrix.rows.splice(rIdx, 1);
    saveMatrixToStorage();
    renderMatrixTable();
    populateLlmRowSelector();
}

async function addCustomVariableColumn() {
    normalizeBatchMatrixState();

    const varName = await promptText({
        title: '新增变量字段',
        message: '模板分镜里写 {字段名}，批量生成时会替换成这一列填的内容。',
        label: '占位符名称（不用写花括号）',
        placeholder: '例如 character2、background、mood',
        confirmText: '添加字段',
        validate: (value) => {
            const sanitized = sanitizeMatrixVariableName(value);
            if (!sanitized) return '无效的变量名称，请只使用字母、数字或下划线。';
            if (MATRIX_RESERVED_FIELDS.has(sanitized)) return `“${sanitized}” 是系统保留字段，请换一个名称。`;
            if (batchMatrix.columns.includes(sanitized)) return `“${sanitized}” 这一列已经存在了。`;
            return '';
        }
    });
    if (varName === null) return;

    const sanitized = sanitizeMatrixVariableName(varName);
    batchMatrix.columns.push(sanitized);
    batchMatrix.rows.forEach(row => {
        row[sanitized] = row[sanitized] || '';
    });

    saveMatrixToStorage();
    renderMatrixTable();
    notify(`已新增变量字段 {${sanitized}}，现在可以在分镜提示词里使用它了。`, { type: 'success' });
}

// 统计某个占位符在所有模板的提示词 / 旁白里被引用了多少处。
function countPlaceholderUsage(name) {
    const token = `{${name}}`;
    let count = 0;
    templates.forEach(tpl => {
        (tpl.steps || []).forEach(step => {
            count += String(step.prompt || '').split(token).length - 1;
            count += String(step.caption || '').split(token).length - 1;
        });
    });
    return count;
}

function rewritePlaceholderInTemplates(oldName, newName) {
    const from = `{${oldName}}`;
    const to = `{${newName}}`;
    let rewritten = 0;
    templates.forEach(tpl => {
        (tpl.steps || []).forEach(step => {
            if (String(step.prompt || '').includes(from)) {
                step.prompt = step.prompt.split(from).join(to);
                rewritten++;
            }
            if (String(step.caption || '').includes(from)) {
                step.caption = step.caption.split(from).join(to);
                rewritten++;
            }
        });
    });
    return rewritten;
}

// 重命名一列变量。关键是同步改写所有模板里的 {占位符}：
// 只改列名不改模板，等于让整套模板静默失效 —— 出图时占位符会原样进提示词。
async function renameMatrixColumn(oldName) {
    normalizeBatchMatrixState();
    if (!batchMatrix.columns.includes(oldName)) return;

    const usage = countPlaceholderUsage(oldName);
    const newName = await promptText({
        title: `重命名变量 {${oldName}}`,
        message: usage > 0
            ? `所有模板里的 ${usage} 处 {${oldName}} 会被同步改写成新名称。`
            : '当前没有任何模板引用这个占位符。',
        label: '新的占位符名称',
        value: oldName,
        confirmText: '重命名',
        validate: (value) => {
            const sanitized = sanitizeMatrixVariableName(value);
            if (!sanitized) return '无效的变量名称，请只使用字母、数字或下划线。';
            if (sanitized === oldName) return '新名称和原名称相同。';
            if (MATRIX_RESERVED_FIELDS.has(sanitized)) return `“${sanitized}” 是系统保留字段。`;
            if (batchMatrix.columns.includes(sanitized)) return `“${sanitized}” 这一列已经存在了。`;
            return '';
        }
    });
    if (newName === null) return;

    const sanitized = sanitizeMatrixVariableName(newName);
    batchMatrix.columns = batchMatrix.columns.map(col => (col === oldName ? sanitized : col));
    batchMatrix.rows.forEach(row => {
        row[sanitized] = row[oldName] ?? '';
        delete row[oldName];
    });
    const rewritten = rewritePlaceholderInTemplates(oldName, sanitized);

    saveMatrixToStorage();
    saveTemplatesToStorage();
    renderMatrixTable();
    renderTemplatesList();
    notify(`{${oldName}} 已改名为 {${sanitized}}，同步改写了模板中的 ${rewritten} 处引用。`, { type: 'success' });
}

// 删除一列变量。
// 此前既没有入口，就算手动从 columns 里去掉也无效：normalizeBatchMatrixState()
// 会从每一行残留的同名 key 上把这一列重新收集回来。所以必须两边一起清。
async function deleteMatrixColumn(name) {
    normalizeBatchMatrixState();
    if (!batchMatrix.columns.includes(name)) return;
    if (DEFAULT_MATRIX_COLUMNS.includes(name)) {
        notifyWarning(`{${name}} 是内置变量，不能删除。`);
        return;
    }

    const usage = countPlaceholderUsage(name);
    const confirmed = await confirmAction({
        title: `删除变量 {${name}}？`,
        message: usage > 0
            ? `所有角色行里这一列填的内容都会被清空。\n另外还有 ${usage} 处模板提示词/旁白在引用 {${name}}，删除后它们不会再被替换，需要你自己改掉。`
            : '所有角色行里这一列填的内容都会被清空。当前没有模板引用它。',
        confirmText: '删除该列',
        danger: true
    });
    if (!confirmed) return;

    batchMatrix.columns = batchMatrix.columns.filter(col => col !== name);
    batchMatrix.rows.forEach(row => { delete row[name]; });

    saveMatrixToStorage();
    renderMatrixTable();
    notify(usage > 0
        ? `已删除变量 {${name}}，请记得处理模板里剩下的 ${usage} 处引用。`
        : `已删除变量 {${name}}。`,
        { type: usage > 0 ? 'warning' : 'success' });
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
        notifyWarning("请先在角色矩阵中勾选至少一行角色。");
        return;
    }
    
    const tplId = document.getElementById('matrix-template-selector').value;
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) {
        notifyError("所选模板已不存在，请重新选择。");
        return;
    }
    
    const llmKey = document.getElementById('llm-api-key').value.trim();
    if (!llmKey && !isMockMode) {
        notifyWarning("请先在「LLM 剧情与模板」里配置 API Key，或打开模拟模式体验离线流程。");
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
                    chunkCaptions = await requestLlmChunkCaptions(resolveGlobalStoryOutline(tpl), chunk, row.bookTitle, chunkIdx, captions);
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
        notify("所选角色的剧本旁白已全部生成入库。", { type: "success" });
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
        notifyWarning("请先选择一个连环画模板。");
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
    syncLegacyOverlayState('script-modal', true, closeScriptModal);
    initLucide();
}

function closeScriptModal() {
    const modal = document.getElementById('script-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    syncLegacyOverlayState('script-modal', false, closeScriptModal);
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
    notify("剧本旁白已保存。", { type: "success" });
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
        notifyWarning("请先配置大模型 API Key。");
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
            captions = await requestLlmAllCaptions(resolveGlobalStoryOutline(tpl), preparedPanels, row.bookTitle);
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

        notify("AI 剧本已生成，并保存为新的剧情版本。", { type: "success" });
    } catch(err) {
        notifyError(`剧本生成出错：${err.message}`);
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
        initLucide();
    }
}
