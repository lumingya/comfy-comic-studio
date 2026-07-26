// js/templates.js - 连环画模板编辑器（模板库、分镜增删改、自动保存）。

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

async function restoreDefaultTemplates() {
    flushTemplateAutosave();
    const confirmed = await confirmAction({
        title: '恢复出厂默认模板？',
        message: `当前的 ${templates.length} 个模板会被两个默认模板整体替换，你自己写的分镜将全部丢失。`,
        confirmText: '恢复默认',
        danger: true
    });
    if (!confirmed) return;
    templates = JSON.parse(JSON.stringify(defaultTemplates));
    activeTemplateId = templates[0].id;
    saveTemplatesToStorage(true);
    renderTemplatesList();
    populateTemplateDropdowns();
    notify('已恢复为默认模板。', { type: 'success' });
}

async function deleteCurrentTemplate() {
    flushTemplateAutosave();
    if (templates.length <= 1) {
        notifyWarning('至少要保留一个画册模板。');
        return;
    }
    const current = templates.find(t => t.id === activeTemplateId);
    const confirmed = await confirmAction({
        title: '删除当前模板？',
        message: `「${current?.title || '未命名模板'}」及其 ${current?.steps?.length || 0} 幕分镜会被删除，此操作不可逆。`,
        confirmText: '删除模板',
        danger: true
    });
    if (!confirmed) return;
    templates = templates.filter(t => t.id !== activeTemplateId);
    activeTemplateId = templates[0].id;
    saveTemplatesToStorage(true);
    renderTemplatesList();
    populateTemplateDropdowns();
    notify(`已删除模板「${current?.title || ''}」。`, { type: 'success' });
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
    notify(`模板「${t.title || '未命名模板'}」已保存（${t.steps.length} 幕）。`, { type: 'success' });
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
                    <div class="flex items-center gap-0.5">
                        <button type="button" onclick="moveStepInActive(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} class="step-tool-btn" title="上移一幕" aria-label="上移一幕">
                            <i data-lucide="arrow-up" class="w-3.5 h-3.5"></i>
                        </button>
                        <button type="button" onclick="moveStepInActive(${idx}, 1)" ${idx === t.steps.length - 1 ? 'disabled' : ''} class="step-tool-btn" title="下移一幕" aria-label="下移一幕">
                            <i data-lucide="arrow-down" class="w-3.5 h-3.5"></i>
                        </button>
                        <button type="button" onclick="duplicateStepInActive(${idx})" class="step-tool-btn" title="在下方复制一幕" aria-label="复制这一幕">
                            <i data-lucide="copy-plus" class="w-3.5 h-3.5"></i>
                        </button>
                        <button type="button" onclick="removeStepFromActive(${idx})" class="step-tool-btn is-danger" title="删除这一幕" aria-label="删除这一幕">
                            <i data-lucide="minus-circle" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
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
    initLucide(container);
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

// 分镜顺序此前只能靠 AI 精修里的 swap_frames 调整，手动编辑器里连上下移动都没有；
// 想把第 7 幕挪到第 3 幕，只能把两边的名称、提示词、旁白逐字段互相复制粘贴。
function moveStepInActive(idx, delta) {
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return;

    const target = idx + delta;
    if (target < 0 || target >= t.steps.length) return;

    syncDomToActiveTemplate();
    const [moved] = t.steps.splice(idx, 1);
    t.steps.splice(target, 0, moved);
    populateActiveTemplateSteps();
    saveTemplatesToStorage();

    // 让被移动的那张卡片保持在视野里，长模板下不至于“移动完就找不到了”
    document.querySelectorAll('.step-editor-card')[target]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function duplicateStepInActive(idx) {
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t || !t.steps[idx]) return;

    syncDomToActiveTemplate();
    const source = t.steps[idx];
    t.steps.splice(idx + 1, 0, {
        name: `${source.name}（副本）`,
        prompt: source.prompt,
        caption: source.caption
    });
    populateActiveTemplateSteps();
    saveTemplatesToStorage();
    notify('已在下方复制这一幕，改几个词就是新的分镜。', { type: 'success' });
    document.querySelectorAll('.step-editor-card')[idx + 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    saveTemplatesToStorage();
    document.querySelectorAll('.step-editor-card')[t.steps.length - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function removeStepFromActive(idx) {
    const t = templates.find(temp => temp.id === activeTemplateId);
    if (!t) return;

    if (t.steps.length <= 1) {
        notifyWarning('至少要保留一幕分镜。');
        return;
    }

    syncDomToActiveTemplate(); // 先把当前 DOM 编辑内容同步回内存
    t.steps.splice(idx, 1);
    populateActiveTemplateSteps();
    saveTemplatesToStorage();
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
