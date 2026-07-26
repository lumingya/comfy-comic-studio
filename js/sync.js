// js/sync.js - 本地 Python 服务磁盘持久化：保存队列、防抖、断点恢复合并。

// ============================================================================
// 💾 LOCAL DISK BACKEND STORAGE & MULTI-BROWSER BACKUP SYNC LOGIC (100% PERSISTENT)
// ============================================================================

// Push state payload to local Python backend server to write to disk comfy_comic_data.json
// Global Write Queue and Debounce control
let saveQueuePromise = Promise.resolve();
let saveDebounceTimeout = null;
let saveDebouncePromise = null;
let resolveDebouncedSave = null;
let destructiveSaveRevision = 0;
let persistedDestructiveSaveRevision = 0;

// Helper to update local updated timestamp
function updateLastActiveTime() {
    const now = Date.now();
    localStorage.setItem('comfy_comic_updated_at', now.toString());
    return now;
}

function getBackendConfigUrl() {
    return getLocalBackendUrl('/api/config');
}

function buildAppStatePayload(forceWrite = false) {
    return {
        templates: templates,
        activeTemplateId: activeTemplateId,
        batchMatrix: batchMatrix,
        savedGalleries: savedGalleries,
        comfyWorkflows: comfyWorkflows,
        activeWorkflowId: activeWorkflowId,
        comfyConfig: getComfyConfigFromDom(),
        llmConfig: getLlmConfigFromDom(),
        xmlConfig: getXmlConfigFromDom(),
        chatConfig: getChatConfigFromState(),
        uiConfig: getUiConfigFromDom(),
        batchRunState: batchRunState,
        xmlSystemPrompt: document.getElementById('xml-system-prompt')?.value || '',
        nodePositive: document.getElementById('node-id-positive')?.value || '6',
        nodeNegative: document.getElementById('node-id-negative')?.value || '',
        nodeOutput: document.getElementById('node-id-output')?.value || '9',
        updatedAt: Date.now(),
        forceWrite
    };
}

function saveConfigBeforePageExit() {
    const backendUrl = getBackendConfigUrl();
    const forceWrite = destructiveSaveRevision > persistedDestructiveSaveRevision;
    const payload = JSON.stringify(buildAppStatePayload(forceWrite));

    try {
        if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            if (navigator.sendBeacon(backendUrl, blob)) return true;
        }
    } catch (err) {
        console.warn('[Sync] sendBeacon save failed:', err.message);
    }

    try {
        fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        }).catch(err => console.warn('[Sync] keepalive save failed:', err.message));
        return true;
    } catch (err) {
        console.warn('[Sync] keepalive save setup failed:', err.message);
        return false;
    }
}

// Push state payload to local Python backend server to write to disk comfy_comic_data.json
function saveConfigToComfyServer(forceWrite = false) {
    if (window.isAppInitializing) {
        console.debug('[Sync] Deferred save request during app initialization.');
        return Promise.resolve();
    }
    if (forceWrite) destructiveSaveRevision += 1;
    // 每次开始调用，确保本地时间戳已同步更新
    updateLastActiveTime();

    if (saveDebounceTimeout) {
        clearTimeout(saveDebounceTimeout);
    }

    if (!saveDebouncePromise) {
        saveDebouncePromise = new Promise((resolve) => {
            resolveDebouncedSave = resolve;
        });
    }

    const pendingPromise = saveDebouncePromise;
    saveDebounceTimeout = setTimeout(async () => {
        const resolveCurrentSave = resolveDebouncedSave;
        saveDebounceTimeout = null;
        saveDebouncePromise = null;
        resolveDebouncedSave = null;
        await enqueueSaveTask();
        if (resolveCurrentSave) resolveCurrentSave();
    }, 500); // 500ms Debounce
    return pendingPromise;
}

// Queue actual network saves to prevent multi-request packet out-of-order execution
async function enqueueSaveTask(forceWrite = false) {
    if (forceWrite) destructiveSaveRevision += 1;
    saveQueuePromise = saveQueuePromise.then(async () => {
        await executeServerSave();
    }).catch(err => {
        console.error('[Sync] Queue execution encountered error: ', err);
    });
    return saveQueuePromise;
}

// Internal server saving executor
async function executeServerSave() {
    const backendUrl = getBackendConfigUrl();

    const syncStatusEl = document.getElementById('cloud-sync-status');
    if (syncStatusEl) {
        syncStatusEl.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin text-blue-500"></i> <span class="text-xs text-slate-400">正在保存到本地...</span>`;
        initLucide(syncStatusEl);
    }

    const capturedDestructiveRevision = destructiveSaveRevision;
    const forceWrite = capturedDestructiveRevision > persistedDestructiveSaveRevision;
    const appState = buildAppStatePayload(forceWrite);

    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(appState)
        });

        if (response.ok) {
            if (forceWrite) {
                persistedDestructiveSaveRevision = Math.max(
                    persistedDestructiveSaveRevision,
                    capturedDestructiveRevision
                );
            }
            console.log('[Sync] Disk backup persistent success.');
            if (syncStatusEl) {
                syncStatusEl.innerHTML = `<i data-lucide="hard-drive-download" class="w-3.5 h-3.5 text-emerald-500"></i> <span class="text-xs text-slate-400">已保存到本地</span>`;
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

function isRecoverableLocalGalleryBook(book, activeBookId = null) {
    if (!book || typeof book !== 'object') return false;
    return !!(
        book.inProgress ||
        book.status === 'generating' ||
        (activeBookId && book.id === activeBookId)
    );
}

function getBookGeneratedStepCount(book) {
    return Array.isArray(book?.steps) ? book.steps.length : 0;
}

function shouldPreferLocalRecoverableBook(localBook, serverBook) {
    if (!serverBook) return true;
    if (!isRecoverableLocalGalleryBook(localBook)) return false;

    const localUpdatedAt = Number(localBook.updatedAt || localBook.createdAt || 0);
    const serverUpdatedAt = Number(serverBook.updatedAt || serverBook.createdAt || 0);
    if (localUpdatedAt > serverUpdatedAt) return true;

    return getBookGeneratedStepCount(localBook) > getBookGeneratedStepCount(serverBook);
}

function mergeRecoverableLocalGalleries(serverGalleries, localGalleries, localBatchState) {
    const merged = Array.isArray(serverGalleries) ? serverGalleries.slice() : [];
    const localList = Array.isArray(localGalleries) ? localGalleries : [];
    const activeBookId = localBatchState?.activeBookId || null;
    let restoredCount = 0;

    localList.slice().reverse().forEach(localBook => {
        if (!isRecoverableLocalGalleryBook(localBook, activeBookId)) return;

        const existingIndex = merged.findIndex(book => book?.id === localBook.id);
        if (existingIndex === -1) {
            merged.unshift(localBook);
            restoredCount++;
            return;
        }

        if (shouldPreferLocalRecoverableBook(localBook, merged[existingIndex])) {
            merged[existingIndex] = localBook;
            restoredCount++;
        }
    });

    return { galleries: merged, restoredCount };
}

function chooseBatchRunState(serverState, localState) {
    const normalizedServer = normalizeBatchRunState(serverState);
    const normalizedLocal = normalizeBatchRunState(localState);
    const localIsRecoverable = normalizedLocal.status === 'active' || normalizedLocal.status === 'stale';
    const localIsNewer = Number(normalizedLocal.updatedAt || 0) > Number(normalizedServer.updatedAt || 0);

    if (localIsRecoverable && localIsNewer) {
        return normalizedLocal;
    }

    return normalizedServer;
}

// Pull config state from local Python backend server data JSON file and synchronize
async function loadConfigFromComfyServer() {
    const backendUrl = getBackendConfigUrl();
    const localSavedGalleries = parseLocalStorageJson('comfy_comic_galleries', []);
    const localBatchRunState = parseLocalStorageJson(BATCH_STATE_KEY, null);
    
    const syncStatusEl = document.getElementById('cloud-sync-status');
    if (syncStatusEl) {
        syncStatusEl.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin text-blue-500"></i> <span class="text-xs text-slate-400">正在读取本地配置...</span>`;
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

        const serverUpdatedAt = parseInt(appState.updatedAt || '0');

        if (appState) {
            if (appState.templates) {
                templates = appState.templates;
                localStorage.setItem('comfy_comic_templates', JSON.stringify(templates));
            }
            if (appState.activeTemplateId) {
                activeTemplateId = appState.activeTemplateId;
            } else if (!activeTemplateId && templates.length > 0) {
                activeTemplateId = templates[0].id;
            }
            if (appState.batchMatrix) {
                batchMatrix = appState.batchMatrix;
                localStorage.setItem('comfy_comic_matrix', JSON.stringify(batchMatrix));
            }
            if (appState.savedGalleries) {
                const recovered = mergeRecoverableLocalGalleries(
                    appState.savedGalleries,
                    localSavedGalleries,
                    localBatchRunState
                );
                savedGalleries = recovered.galleries;
                if (recovered.restoredCount > 0) {
                    console.warn(`[Sync] Restored ${recovered.restoredCount} in-progress gallery book(s) from LocalStorage.`);
                    shouldSaveAfterInitialization = true;
                }
                // 历史遗留：把所有指向外网图床的分镜图迁移成本地矢量占位图
                let migratedRemoteImages = 0;
                savedGalleries.forEach(book => {
                    if (book.steps) {
                        book.steps.forEach(step => {
                            // 历史数据里残留的外网图床地址一律迁移为本地占位图，避免断网时破图。
                            if (typeof step.image === 'string' && /^https?:\/\/images\.unsplash\.com\//i.test(step.image)) {
                                step.image = makeLocalArtPlaceholder(`${book.id}:${step.name || ''}`, step.name || '');
                                migratedRemoteImages++;
                            }
                        });
                    }
                });
                if (migratedRemoteImages > 0) {
                    console.warn(`[Sync] 已把 ${migratedRemoteImages} 张外网图床分镜图迁移为本地占位图。`);
                    shouldSaveAfterInitialization = true;
                }
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
                const serverBatchRunState = normalizeBatchRunState(appState.batchRunState);
                batchRunState = chooseBatchRunState(serverBatchRunState, localBatchRunState);
                if (batchRunState !== serverBatchRunState) {
                    shouldSaveAfterInitialization = true;
                }
                localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(batchRunState));
            } else if (localBatchRunState) {
                batchRunState = normalizeBatchRunState(localBatchRunState);
                localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(batchRunState));
            }
            if (appState.comfyConfig) {
                syncComfyConfigToLocalStorage(appState.comfyConfig);
            }
            if (appState.llmConfig) {
                syncLlmConfigToLocalStorage(appState.llmConfig);
            }
            if (appState.xmlConfig) {
                syncXmlConfigToLocalStorage(appState.xmlConfig);
            }
            if (appState.chatConfig) {
                applyChatConfig(appState.chatConfig);
            }
            if (appState.uiConfig) {
                syncUiConfigToLocalStorage(appState.uiConfig);
            }
            if (Object.prototype.hasOwnProperty.call(appState, 'xmlSystemPrompt')) {
                localStorage.setItem('xml_system_prompt', appState.xmlSystemPrompt || '');
                const xmlSystemPromptInput = document.getElementById('xml-system-prompt');
                if (xmlSystemPromptInput) {
                    xmlSystemPromptInput.value = appState.xmlSystemPrompt || (window.DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT || '');
                }
            }
            if (appState.nodePositive) localStorage.setItem('comfy_node_positive', appState.nodePositive);
            if (Object.prototype.hasOwnProperty.call(appState, 'nodeNegative')) localStorage.setItem('comfy_node_negative', appState.nodeNegative || '');
            if (appState.nodeOutput) localStorage.setItem('comfy_node_output', appState.nodeOutput);
            
            // 将服务器拉取来的最新时间戳写入本地作为同步基线
            localStorage.setItem('comfy_comic_updated_at', serverUpdatedAt.toString());

            console.log('[LocalServer] Master state configuration loaded from local disk successfully!');
            
            if (syncStatusEl) {
                syncStatusEl.innerHTML = `<i data-lucide="hard-drive-download" class="w-3.5 h-3.5 text-emerald-500"></i> <span class="text-xs text-slate-400">已加载本地配置</span>`;
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
