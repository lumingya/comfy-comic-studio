// js/marketplace.js - 依托 GitHub 的零运维模版与插件生态集市（Marketplace）
// 支持去中心化浏览、一键安装、自定义 GitHub URL 导入以及自制模板发布导出。

let marketplaceCatalog = null;
let activeMarketplaceTab = 'storyboards';
let marketplaceSearch = '';

async function openMarketplaceModal() {
    const modal = document.getElementById('marketplace-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (typeof syncLegacyOverlayState === 'function') {
        syncLegacyOverlayState('marketplace-modal', true, closeMarketplaceModal);
    }
    initLucide(modal);

    if (!marketplaceCatalog) {
        await loadMarketplaceCatalog();
    } else {
        renderMarketplaceList();
    }
}

function closeMarketplaceModal() {
    const modal = document.getElementById('marketplace-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        if (typeof syncLegacyOverlayState === 'function') {
            syncLegacyOverlayState('marketplace-modal', false, closeMarketplaceModal);
        }
    }
}

async function loadMarketplaceCatalog() {
    const container = document.getElementById('marketplace-cards-container');
    if (container) {
        container.innerHTML = `
            <div class="col-span-full py-16 text-center text-slate-400 dark:text-slate-500">
                <i data-lucide="loader" class="w-8 h-8 animate-spin mx-auto mb-3 text-blue-500"></i>
                <p class="text-sm">正在加载模版集市索引...</p>
            </div>
        `;
        initLucide(container);
    }

    try {
        const resp = await fetch(getLocalBackendUrl('/api/marketplace/index'));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        marketplaceCatalog = await resp.json();
        renderMarketplaceList();
    } catch (err) {
        if (container) {
            container.innerHTML = `
                <div class="col-span-full py-12 text-center text-red-500">
                    <i data-lucide="alert-circle" class="w-8 h-8 mx-auto mb-2"></i>
                    <p class="text-sm">加载集市失败：${escapeHtml(err.message)}</p>
                    <button type="button" onclick="loadMarketplaceCatalog()" class="mt-3 px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-xs rounded-lg hover:bg-slate-300">重试</button>
                </div>
            `;
            initLucide(container);
        }
    }
}

function switchMarketplaceTab(tab) {
    activeMarketplaceTab = tab;
    ['storyboards', 'exportPresets'].forEach(t => {
        const btn = document.getElementById(`mp-tab-btn-${t}`);
        if (!btn) return;
        if (t === tab) {
            btn.className = "px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white shadow-md shadow-blue-500/20";
        } else {
            btn.className = "px-4 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition";
        }
    });
    renderMarketplaceList();
}

function onMarketplaceSearchInput(e) {
    marketplaceSearch = (e.target.value || '').trim().toLowerCase();
    renderMarketplaceList();
}

function renderMarketplaceList() {
    const container = document.getElementById('marketplace-cards-container');
    if (!container || !marketplaceCatalog) return;

    container.innerHTML = '';
    const isStoryboards = activeMarketplaceTab === 'storyboards';
    const items = isStoryboards 
        ? (marketplaceCatalog.storyboards || []) 
        : (marketplaceCatalog.exportPresets || []);

    const filtered = items.filter(item => {
        if (!marketplaceSearch) return true;
        const tagsStr = Array.isArray(item.tags)
            ? item.tags.join(' ')
            : (typeof item.tags === 'string' ? item.tags : '');
        const haystack = [item.title || item.name, item.desc, item.author, tagsStr].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(marketplaceSearch);
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-16 text-center text-slate-400 dark:text-slate-500">
                <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
                <p class="text-sm">未找到匹配的模版项</p>
            </div>
        `;
        initLucide(container);
        return;
    }

    filtered.forEach(item => {
        if (isStoryboards) {
            const isInstalled = (templates || []).some(t => t.title === item.title || t.id === item.id);
            const tagsList = Array.isArray(item.tags)
                ? item.tags
                : (typeof item.tags === 'string' ? item.tags.split(/[,\s]+/).filter(Boolean) : []);
            const card = `
                <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between hover:border-blue-500/40 hover:shadow-lg transition-all group">
                    <div>
                        <div class="flex items-start justify-between gap-2 mb-2">
                            <span class="text-xs font-mono px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-bold border border-blue-500/20">
                                ${item.stepsCount || (item.data?.steps || []).length} 幕分镜
                            </span>
                            <span class="text-[11px] text-slate-400 flex items-center gap-1">
                                <i data-lucide="user" class="w-3 h-3"></i> ${escapeHtml(item.author || '社区')}
                            </span>
                        </div>
                        <h4 class="text-base font-bold text-slate-800 dark:text-slate-100 group-hover:text-blue-500 transition-colors mb-2">
                            ${escapeHtml(item.title)}
                        </h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-3 mb-4">
                            ${escapeHtml(item.desc)}
                        </p>
                        ${tagsList.length > 0 ? `
                            <div class="flex flex-wrap gap-1 mb-4">
                                ${tagsList.map(tag => `<span class="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">#${escapeHtml(tag)}</span>`).join('')}
                            </div>
                        ` : ''}
                    </div>

                    <div class="pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-2">
                        ${isInstalled ? `
                            <span class="text-xs text-emerald-500 flex items-center gap-1 font-semibold">
                                <i data-lucide="check-circle-2" class="w-4 h-4"></i> 已安装
                            </span>
                            <button type="button" onclick="installStoryboardTemplate(${inlineJsString(item.id)}, true)" class="px-3 py-1.5 text-xs text-slate-500 hover:text-blue-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition">
                                重新导入为副本
                            </button>
                        ` : `
                            <span></span>
                            <button type="button" onclick="installStoryboardTemplate(${inlineJsString(item.id)})" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-blue-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer">
                                <i data-lucide="download-cloud" class="w-3.5 h-3.5"></i> 一键安装
                            </button>
                        `}
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', card);
        } else {
            // 画册导出预设
            const card = `
                <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between hover:border-indigo-500/40 hover:shadow-lg transition-all">
                    <div>
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <span class="text-xs font-mono px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 font-bold border border-indigo-500/20">
                                ${escapeHtml(item.badge || '导出版式')}
                            </span>
                            <span class="text-[11px] text-slate-400 flex items-center gap-1">
                                <i data-lucide="sparkles" class="w-3 h-3 text-amber-500"></i> ${escapeHtml(item.author || '官方')}
                            </span>
                        </div>
                        <h4 class="text-base font-bold text-slate-800 dark:text-slate-100 mb-2">
                            ${escapeHtml(item.name)}
                        </h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                            ${escapeHtml(item.desc)}
                        </p>
                    </div>
                    <div class="pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
                        <span class="text-xs text-emerald-500 font-semibold flex items-center gap-1">
                            <i data-lucide="check" class="w-3.5 h-3.5"></i> 系统内置就绪
                        </span>
                        <button type="button" onclick="quickPreviewExportPreset(${inlineJsString(item.id)})" class="px-3 py-1.5 text-xs text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition font-medium">
                            查看说明
                        </button>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', card);
        }
    });

    initLucide(container);
}

function installStoryboardTemplate(tplId, asCopy = false) {
    if (!marketplaceCatalog || !Array.isArray(marketplaceCatalog.storyboards)) return;
    const item = marketplaceCatalog.storyboards.find(s => s.id === tplId);
    if (!item || !item.data) {
        notifyError("未找到该模版内容");
        return;
    }

    if (typeof syncDomToActiveTemplate === 'function') syncDomToActiveTemplate();
    if (typeof flushTemplateAutosave === 'function') flushTemplateAutosave();

    const tplData = JSON.parse(JSON.stringify(item.data));
    tplData.id = "tpl_" + Date.now() + (asCopy ? "_copy" : "");
    if (asCopy) {
        tplData.title = `${tplData.title} (副本)`;
    }

    templates.unshift(tplData);
    activeTemplateId = tplData.id;
    saveTemplatesToStorage();
    renderTemplatesList();
    populateTemplateDropdowns();

    notifySuccess(`成功安装模板「${tplData.title}」！`);
    renderMarketplaceList();
}

async function importFromCustomGithubUrl() {
    const input = document.getElementById('custom-github-url-input');
    const url = (input?.value || '').trim();
    if (!url) {
        notifyError("请输入有效的 GitHub 仓库或 Raw JSON 链接");
        return;
    }

    const btn = document.getElementById('btn-import-custom-url');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> 拉取中...`;
        initLucide(btn);
    }

    try {
        let fetchUrl = url;
        // 智能兼容：将 github.com/user/repo/blob/main/... 转换为 raw.githubusercontent.com
        if (fetchUrl.includes('github.com') && fetchUrl.includes('/blob/')) {
            fetchUrl = fetchUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
        }

        const resp = await fetch(getLocalBackendUrl('/api/marketplace/fetch-remote'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: fetchUrl })
        });

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${resp.status}`);
        }

        const result = await resp.json();
        const payload = result.data;

        // 格式解构与智能兼容：兼容自制分享包 { template: { steps } }、{ data: { steps } } 与扁平 { steps }
        const tplObj = (payload && typeof payload === 'object' && payload.template) ? payload.template : ((payload && typeof payload === 'object' && payload.data) ? payload.data : payload);
        const rawSteps = tplObj && tplObj.steps;

        if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
            throw new Error("下载的 JSON 缺少有效或非空的 steps 分镜数组");
        }

        // 严格清洗与归一化分镜对象
        const cleanedSteps = rawSteps
            .filter(s => s && typeof s === 'object')
            .map((s, idx) => ({
                id: s.id || `step_${Date.now()}_${idx}`,
                name: String(s.name || `分镜 ${idx + 1}`),
                prompt: String(s.prompt || ''),
                caption: String(s.caption || ''),
                description: String(s.description || s.caption || ''),
                negativePrompt: String(s.negativePrompt || ''),
                seed: typeof s.seed === 'number' ? s.seed : -1
            }));

        if (cleanedSteps.length === 0) {
            throw new Error("steps 数组中没有有效的分镜配置");
        }

        if (typeof syncDomToActiveTemplate === 'function') syncDomToActiveTemplate();
        if (typeof flushTemplateAutosave === 'function') flushTemplateAutosave();

        const importedTpl = {
            id: "tpl_import_" + Date.now(),
            title: tplObj.title || (payload && payload.name) || "导入的社区模板",
            desc: tplObj.desc || `来源: ${url}`,
            steps: cleanedSteps
        };

        templates.unshift(importedTpl);
        activeTemplateId = importedTpl.id;
        saveTemplatesToStorage();
        renderTemplatesList();
        populateTemplateDropdowns();

        if (input) input.value = '';
        notifySuccess(`成功导入并激活模版：「${importedTpl.title}」！`);
        closeMarketplaceModal();
        switchTab('templates');
    } catch (err) {
        notifyError(`从链接导入失败：${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
            initLucide(btn);
        }
    }
}

function exportCurrentTemplateAsPackage() {
    if (typeof syncDomToActiveTemplate === 'function') syncDomToActiveTemplate();
    if (typeof flushTemplateAutosave === 'function') flushTemplateAutosave();

    const current = templates.find(t => t.id === activeTemplateId);
    if (!current) {
        notifyError("请先在模板配置中选择一个模板");
        return;
    }

    const packageData = {
        name: current.title,
        version: "1.0.0",
        author: "ComfyComic User",
        exportedAt: new Date().toISOString(),
        template: {
            title: current.title,
            desc: current.desc,
            steps: current.steps
        }
    };

    const blob = new Blob([JSON.stringify(packageData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `${(current.title || '模板').replace(/[\\/:*?"<>|]/g, '_')}_社区分享包.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    notifySuccess("模版包已导出，可直接提交到 GitHub 仓库分享！");
}

function quickPreviewExportPreset(presetId) {
    const preset = (window.COMIC_EXPORT_PRESETS || []).find(p => p.id === presetId);
    if (!preset) return;
    const notifyFn = window.notifyInfo || window.notify || console.log;
    notifyFn(`【${preset.name}】在画廊中点击“打包下载整本漫画”时即可选用该版式导出！`);
}

window.openMarketplaceModal = openMarketplaceModal;
window.closeMarketplaceModal = closeMarketplaceModal;
window.switchMarketplaceTab = switchMarketplaceTab;
window.onMarketplaceSearchInput = onMarketplaceSearchInput;
window.installStoryboardTemplate = installStoryboardTemplate;
window.importFromCustomGithubUrl = importFromCustomGithubUrl;
window.exportCurrentTemplateAsPackage = exportCurrentTemplateAsPackage;
window.quickPreviewExportPreset = quickPreviewExportPreset;
