// js/batch.js - 批量出图流水线：任务编排、进度、取消与失败降级。

// 一本画册里还缺哪些幕。
// “缺”有两种：这一幕根本没生成（中断/失败留下的空档），
// 以及生成时 ComfyUI 报错、被降级成了本地占位图。
function getMissingPanelIndices(book) {
    const total = Number(book?.totalSteps) || (Array.isArray(book?.steps) ? book.steps.length : 0);
    if (!total) return [];

    const rendered = new Map();
    (book.steps || []).forEach((step, fallbackIdx) => {
        const idx = Number.isInteger(step?.stepIndex) ? step.stepIndex : fallbackIdx;
        rendered.set(idx, step);
    });

    const missing = [];
    for (let idx = 0; idx < total; idx++) {
        const step = rendered.get(idx);
        if (!step || !step.image || step.image === OFFLINE_PLACEHOLDER_IMAGE) missing.push(idx);
    }
    return missing;
}

// 把一幕画好之后写回画册（可能是补齐已有位置，也可能是新增）。
function upsertBookPanel(book, stepIndex, panel) {
    if (!Array.isArray(book.steps)) book.steps = [];
    const existing = book.steps.findIndex((step, fallbackIdx) =>
        (Number.isInteger(step?.stepIndex) ? step.stepIndex : fallbackIdx) === stepIndex);
    const entry = { stepIndex, ...panel };
    if (existing >= 0) book.steps[existing] = entry;
    else book.steps.push(entry);
    book.generatedSteps = book.steps.length;
    book.updatedAt = Date.now();
}

// 画一幕：生产模式走 ComfyUI，模拟模式走本地矢量图。
// 失败时返回本地占位图，这样“哪些幕需要补”这个判断始终成立。
async function renderPanelImage(promptText, seedHint, panelIndex, panelName) {
    if (isMockMode) {
        addLog(`⚡ [模拟生图中] ComfyUI 接收节点并启动 KSampler...`);
        await sleep(600);
        if (cancelRequested) throw new BatchCancelError("User requested cancellation.");
        addLog(`✅ [模拟成功] 图像已接收！`, "text-emerald-500");
        return getMockVisual(seedHint, panelIndex, panelName);
    }

    addLog(`⚡ 向 ComfyUI 发送绘制任务，等待渲染队列...`);
    try {
        const url = await submitToRealComfy(promptText);
        addLog(`✅ 图像接收下载完成！`, "text-emerald-500");
        return url;
    } catch (err) {
        if (err instanceof BatchCancelError || err.name === 'BatchCancelError' || cancelRequested) {
            throw new BatchCancelError("User requested cancellation.");
        }
        addLog(`❌ ComfyUI 生成图片错误: ${err.message}`, "text-red-500 font-bold");
        addLog(`已启用纯本地 SVG 矢量图进行安全降级容错，稍后可用“补齐”只重跑这一幕。`, "text-amber-400");
        return OFFLINE_PLACEHOLDER_IMAGE;
    }
}

// 只重跑一本画册里缺失/失败的分镜。
// 在此之前，一轮 30 幕的任务如果在第 28 幕断掉，唯一的办法是整本从头再来 ——
// 已经画好的 27 张图会被重画一遍，白白烧掉几十分钟 GPU 时间。
async function resumeBookGeneration(bookId) {
    if (runningBatch) {
        notifyWarning('已经有批量任务在跑了，等它结束再补齐。');
        return;
    }

    const book = savedGalleries.find(item => item.id === bookId);
    if (!book) return;

    const missing = getMissingPanelIndices(book);
    if (missing.length === 0) {
        notify('这本画册已经是完整的了。', { type: 'success' });
        return;
    }

    const tpl = templates.find(t => t.id === book.templateId);
    const row = (batchMatrix.rows || []).find(r => r.id === book.rowId);
    if (!tpl || !row) {
        notifyError('找不到这本画册对应的模板或角色行，无法补齐。可以改用单页精修重绘。');
        return;
    }

    if (!isMockMode && !comfyWorkflowRaw) {
        notifyWarning('生产模式下需要先导入 ComfyUI 工作流才能补齐。');
        return;
    }

    const confirmed = await confirmAction({
        title: `补齐「${book.title}」缺失的 ${missing.length} 幕？`,
        message: `已经画好的 ${(book.totalSteps || 0) - missing.length} 幕不会重画，只重跑第 `
            + `${missing.slice(0, 8).map(i => i + 1).join('、')}${missing.length > 8 ? ' 等' : ''} 幕。`,
        confirmText: '开始补齐'
    });
    if (!confirmed) return;

    runningBatch = true;
    cancelRequested = false;
    switchTab('variables');
    document.getElementById('progress-card')?.classList.remove('hidden');
    document.getElementById('btn-run-batch')?.classList.add('hidden');
    const cancelBtn = document.getElementById('btn-cancel-batch');
    if (cancelBtn) {
        cancelBtn.classList.remove('hidden');
        cancelBtn.classList.add('flex');
        cancelBtn.disabled = false;
    }

    batchRunState = createEmptyBatchRunState();
    setBatchRunState('active', {
        sessionId: BATCH_SESSION_ID,
        tplId: tpl.id,
        templateTitle: tpl.title,
        activeBookId: book.id,
        currentBookTitle: book.title,
        progressPct: 0,
        progressLabel: `补齐《${book.title}》缺失的 ${missing.length} 幕`,
        startedAt: Date.now()
    }, true);

    book.inProgress = true;
    book.status = 'generating';
    saveGalleriesToStorage();
    renderGallery();

    addLog(`🩹 开始补齐《${book.title}》：共 ${missing.length} 幕待重绘。`, "text-blue-400 font-bold");
    const storyCaptions = getActiveStoryCaptions(row, tpl.id);

    try {
        for (let n = 0; n < missing.length; n++) {
            if (cancelRequested) throw new BatchCancelError("User requested cancellation.");

            const idx = missing[n];
            const step = tpl.steps[idx];
            if (!step) {
                addLog(`⚠️ 模板里已经没有第 ${idx + 1} 幕了，跳过。`, "text-amber-400");
                continue;
            }

            const prompt = replaceTemplatePlaceholders(step.prompt, row);
            addLog(`📍 正在补齐第 ${idx + 1} 幕 [${step.name}]...`);
            const image = await renderPanelImage(prompt, row.style, idx, step.name);

            upsertBookPanel(book, idx, {
                name: step.name,
                prompt,
                caption: storyCaptions[idx] || replaceTemplatePlaceholders(step.caption, row),
                image
            });
            saveGalleriesToStorage();
            refreshGalleryCard(book.id);
            setBatchProgress(Math.floor(((n + 1) / missing.length) * 100), `补齐《${book.title}》 ${n + 1}/${missing.length}`);
        }

        const stillMissing = getMissingPanelIndices(book);
        book.inProgress = false;
        book.status = stillMissing.length === 0 ? 'complete' : 'failed';
        book.completedAt = Date.now();
        saveGalleriesToStorage();
        renderGallery();

        if (stillMissing.length === 0) {
            addLog(`🎉 《${book.title}》已补齐完整。`, "text-emerald-400 font-bold");
            setBatchRunState('completed', { progressPct: 100, progressLabel: '补齐完成' }, true);
            notify(`《${book.title}》已补齐完整。`, { type: 'success' });
        } else {
            addLog(`⚠️ 仍有 ${stillMissing.length} 幕没能画出来。`, "text-amber-400 font-bold");
            setBatchRunState('failed', { progressLabel: `仍缺 ${stillMissing.length} 幕` }, true);
            notifyWarning(`还有 ${stillMissing.length} 幕没画成，检查 ComfyUI 日志后可以再补一次。`);
        }
    } catch (err) {
        book.inProgress = false;
        book.status = 'canceled';
        book.updatedAt = Date.now();
        saveGalleriesToStorage();
        renderGallery();
        const isCancel = err instanceof BatchCancelError || err.name === 'BatchCancelError';
        addLog(isCancel ? '🛑 补齐任务已被手动终止，已画好的分镜都已保留。' : `❌ 补齐过程出错：${err.message}`,
            "text-red-500 font-bold");
        setBatchRunState(isCancel ? 'canceled' : 'failed', { progressLabel: isCancel ? '补齐已停止' : '补齐失败' }, true);
        if (!isCancel) notifyError(`补齐中断：${err.message}`);
    } finally {
        runningBatch = false;
        cancelRequested = false;
        document.getElementById('btn-run-batch')?.classList.remove('hidden');
        const btn = document.getElementById('btn-cancel-batch');
        if (btn) {
            btn.classList.add('hidden');
            btn.classList.remove('flex');
            btn.disabled = false;
        }
    }
}

// --- TAB 3: DECOUPLED IMAGE DRAWING PIPELINE ---
let activeBatchAuditAbortController = null;

async function cancelBatchGeneration() {
    const canControlPersistedRun = batchRunState.status === 'active' || batchRunState.status === 'stale';
    if (!runningBatch && !canControlPersistedRun) return;

    cancelRequested = true;
    if (activeBatchAuditAbortController) {
        try { activeBatchAuditAbortController.abort("用户终止批量任务"); } catch (e) {}
    }
    const cancelBtn = document.getElementById('btn-cancel-batch');
    if (cancelBtn) cancelBtn.disabled = true;

    addLog("收到用户终止指令，正在物理打断 ComfyUI 生图并取消后续队列...", "text-red-400 font-bold");
    await interruptComfy();

    if (!runningBatch) {
        addLog("已向 ComfyUI 发送中断和清队列请求。当前浏览器中没有可继续轮询的活动任务。", "text-amber-400 font-bold");
        setBatchRunState('canceled', {
            progressLabel: '已发送中断请求',
            sessionId: BATCH_SESSION_ID
        }, true);
    } else if (cancelBtn) {
        cancelBtn.disabled = false;
    }
}

async function startBatchGeneration() {
    if (runningBatch) return;

    await appReadyPromise.catch(err => {
        console.warn('[Init] Previous state synchronization failed before starting batch:', err.message);
    });

    saveMatrixToStorage();

    const tplId = document.getElementById('matrix-template-selector').value;
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) {
        notifyError("所选模板已不存在，请重新选择。");
        return;
    }

    const activeRows = batchMatrix.rows.filter(r => r.active);
    if (activeRows.length === 0) {
        notifyWarning("当前没有勾选启用的角色，请在表格左侧勾选至少一行。");
        return;
    }

    if (!isMockMode) {
        const posNodeId = document.getElementById('node-id-positive').value.trim();
        const outNodeId = document.getElementById('node-id-output').value.trim();
        if (!posNodeId || !outNodeId) {
            notifyWarning("生产模式下必须指定积极提示词节点和图像输出节点 ID，请先在「ComfyUI 工作流」里配置。");
            return;
        }
        if (!comfyWorkflowRaw) {
            notifyWarning("生产模式下必须先上传 ComfyUI 导出的 API 格式 JSON 工作流。");
            return;
        }
    }

    runningBatch = true;
    cancelRequested = false;
    document.getElementById('progress-card').classList.remove('hidden');
    document.getElementById('btn-run-batch').classList.add('hidden');
    document.getElementById('btn-cancel-batch').classList.remove('hidden');
    document.getElementById('btn-cancel-batch').classList.add('flex');
    document.getElementById('btn-cancel-batch').disabled = false;
    document.getElementById('progress-logs').innerHTML = '';

    batchRunState = createEmptyBatchRunState();
    setBatchRunState('active', {
        sessionId: BATCH_SESSION_ID,
        tplId,
        templateTitle: tpl.title,
        progressPct: 0,
        progressLabel: `准备生成 ${activeRows.length} 套故事`,
        logs: [],
        startedAt: Date.now()
    }, true);

    addLog(`⚡ [ComfyUI 图片绘制] 流水线启动！共有 ${activeRows.length} 套角色，模板：${tpl.title}`, "text-blue-400 font-bold");

    let currentBookIndex = 0;
    const totalBooks = activeRows.length;
    const totalStepsInTpl = tpl.steps.length;
    const grandTotalSubmissions = totalBooks * totalStepsInTpl;
    let currentFinishedSubmission = 0;
    let currentBook = null;
    let consecutiveAuditFailures = 0;

    try {
        for (let i = 0; i < activeRows.length; i++) {
            if (cancelRequested) {
                throw new BatchCancelError("User requested cancellation.");
            }
            const row = activeRows[i];
            currentBookIndex++;

            const bookTitle = row.bookTitle;
            
            addLog(`----------------------------------------`);
            addLog(`🎬 开始绘制第 ${currentBookIndex}/${totalBooks} 本画册：【${bookTitle}】`, "text-indigo-400 font-bold");

            const characterLabel = getPrimaryCharacterLabel(row);
            const activeStoryVersion = getActiveStoryVersion(row, tplId);
            const storyCaptions = activeStoryVersion ? activeStoryVersion.captions : getActiveStoryCaptions(row, tplId);
            const storyTitle = activeStoryVersion?.title || '模板默认剧情';
            const newBook = {
                id: "book_" + Date.now() + "_" + i,
                title: bookTitle || `探索画册_${i}`,
                characterName: characterLabel ? characterLabel.substring(0, 10) + "..." : "未命名角色",
                rowId: row.id,
                rowTitle: row.bookTitle || '',
                templateId: tplId,
                templateTitle: tpl.title,
                storyVersionId: activeStoryVersion?.id || '',
                storyTitle,
                synopsis: resolveGlobalStoryOutline(tpl) || `利用公式《${tpl.title}》创作而成的精美组图。`,
                tags: ["AI连连看", "ComfyUI", "批量绘图"],
                totalSteps: tpl.steps.length,
                generatedSteps: 0,
                inProgress: true,
                status: "generating",
                createdAt: Date.now(),
                steps: []
            };
            currentBook = newBook;
            savedGalleries.unshift(newBook);
            await saveGalleriesToStorage(true);
            renderGallery();
            setBatchRunState('active', {
                activeBookId: newBook.id,
                currentBookTitle: newBook.title,
                progressLabel: `正在生成第 ${currentBookIndex}/${totalBooks} 套故事`
            }, true);

            // Prepare final prompts with variables
            const preparedPanels = tpl.steps.map((step, idx) => {
                const finalPrompt = replaceTemplatePlaceholders(step.prompt, row);
                const finalCaption = replaceTemplatePlaceholders(step.caption, row);
                return {
                    name: step.name,
                    prompt: finalPrompt,
                    fallbackCaption: finalCaption
                };
            });

            // Step sequence loop
            for (let j = 0; j < tpl.steps.length; j++) {
                if (cancelRequested) {
                    throw new BatchCancelError("User requested cancellation.");
                }

                const panelData = preparedPanels[j];
                addLog(`📍 正在渲染分镜 [${panelData.name}]...`);

                // Get cached script text (完全解耦大模型网络请求)
                let generatedStoryLine = "";
                if (storyCaptions && storyCaptions[j]) {
                    generatedStoryLine = storyCaptions[j];
                    addLog(`📖 加载预设的旁白: "${generatedStoryLine.substring(0, 15)}..."`, "text-slate-500");
                } else {
                    generatedStoryLine = panelData.fallbackCaption;
                    addLog(`📖 使用模板默认旁白: "${generatedStoryLine.substring(0, 15)}..."`, "text-slate-500");
                }

                // Call ComfyUI for image
                let renderedImgUrl = "";
                if (!isMockMode) {
                    addLog(`⚡ 向 ComfyUI 发送绘制任务，等待渲染队列...`);
                    try {
                        renderedImgUrl = await submitToRealComfy(panelData.prompt);
                        addLog(`✅ 图像接收下载完成！`, "text-emerald-500");
                    } catch (err) {
                        // 若抛出的是主动取消错误，或者取消信号已被激活，不进行占位降级，直接重抛阻断程序
                        if (err instanceof BatchCancelError || err.name === 'BatchCancelError' || cancelRequested) {
                            throw new BatchCancelError("User requested cancellation.");
                        }
                        addLog(`❌ ComfyUI 生成图片错误: ${err.message}`, "text-red-500 font-bold");
                        addLog(`已启用纯本地 SVG 矢量图进行安全降级容错。`);
                        renderedImgUrl = OFFLINE_PLACEHOLDER_IMAGE;
                    }
                } else {
                    addLog(`⚡ [模拟生图中] ComfyUI 接收节点并启动 KSampler...`);
                    await sleep(1500);
                    if (cancelRequested) {
                        throw new BatchCancelError("User requested cancellation.");
                    }
                    renderedImgUrl = getMockVisual(row.style, j, panelData.name);
                    addLog(`✅ [模拟成功] 图像已接收！`, "text-emerald-500");
                }

                newBook.steps.push({
                    stepIndex: j,
                    name: panelData.name,
                    prompt: panelData.prompt,
                    caption: generatedStoryLine,
                    image: renderedImgUrl
                });
                newBook.generatedSteps = newBook.steps.length;
                newBook.updatedAt = Date.now();
                saveGalleriesToStorage();
                refreshGalleryCard(newBook.id);

                // 可选的自动化多模态视觉审校
                const autoAuditEl = document.getElementById('matrix-auto-audit-toggle');
                if (autoAuditEl && autoAuditEl.checked && window.VisualCritic && renderedImgUrl && renderedImgUrl !== OFFLINE_PLACEHOLDER_IMAGE) {
                    if (cancelRequested) {
                        throw new BatchCancelError("User requested cancellation.");
                    }
                    addLog(`🔍 [AI 审校] 正在自动分析分镜画面解剖与一致性...`, "text-purple-400");
                    activeBatchAuditAbortController = new AbortController();
                    try {
                        const critique = await VisualCritic.auditPanel(
                            newBook,
                            newBook.steps.length - 1,
                            activeBatchAuditAbortController.signal
                        );
                        if (cancelRequested) {
                            throw new BatchCancelError("User requested cancellation.");
                        }
                        if (critique) {
                            consecutiveAuditFailures = 0;
                            const rawScore = critique.score;
                            const scoreVal = (typeof rawScore === 'number' && !isNaN(rawScore))
                                ? rawScore
                                : (!isNaN(Number(rawScore)) && rawScore !== null && rawScore !== '' ? Number(rawScore) : 8);
                            const isAuditPassed = (String(critique.passed).toLowerCase() === 'true' || critique.passed === true) && scoreVal >= 7;
                            addLog(`✨ [审校结果] 得分 ${scoreVal}/10: ${critique.summary || '合格'}`, isAuditPassed ? "text-emerald-400" : "text-amber-400");
                        }
                    } catch (auditErr) {
                        if (auditErr instanceof BatchCancelError || auditErr.name === 'BatchCancelError' || cancelRequested) {
                            throw new BatchCancelError("User requested cancellation.");
                        }
                        consecutiveAuditFailures = (typeof consecutiveAuditFailures === 'number' ? consecutiveAuditFailures : 0) + 1;
                        addLog(`⚠️ [审校提示] ${auditErr.message}`, "text-slate-500");
                        if (consecutiveAuditFailures >= 3) {
                            addLog(`⚠️ [审校熔断] 视觉审校已连续失败 3 次，为避免阻塞绘图进度，本轮自动审校已熔断挂起。`, "text-amber-400");
                            if (autoAuditEl) autoAuditEl.checked = false;
                        }
                    } finally {
                        activeBatchAuditAbortController = null;
                    }
                }

                currentFinishedSubmission++;
                const percent = Math.floor((currentFinishedSubmission / grandTotalSubmissions) * 100);
                setBatchProgress(percent, `正在生成第 ${currentBookIndex}/${totalBooks} 套故事`);
            }

            newBook.inProgress = false;
            newBook.status = "complete";
            newBook.generatedSteps = newBook.steps.length;
            newBook.completedAt = Date.now();
            saveGalleriesToStorage();
            renderGallery();
        }

        addLog(`🎉 恭喜！批量图片绘制已圆满完成！前往【画廊展厅】即可品味画册成品。`, "text-emerald-400 font-bold");
        setBatchRunState('completed', {
            activeBookId: null,
            currentBookTitle: '',
            progressPct: 100,
            progressLabel: '全部画册生成完成'
        }, true);
        notify(`批量绘制完成，共产出 ${totalBooks} 本画册。`, { type: "success", title: "全部完成" });
        switchTab('gallery');

    } catch (err) {
        if (err instanceof BatchCancelError || err.name === 'BatchCancelError') {
            if (currentBook) {
                currentBook.inProgress = false;
                currentBook.status = "canceled";
                currentBook.generatedSteps = currentBook.steps.length;
                currentBook.updatedAt = Date.now();
                saveGalleriesToStorage();
                renderGallery();
            }
            addLog(`🛑 绘图任务已被手动物理终止。已保留当前画册中已经生成的 ${currentBook?.steps?.length || 0} 张图片。`, "text-red-500 font-bold");
            setBatchRunState('canceled', {
                progressLabel: '任务已停止，已保留已生成图片',
                activeBookId: currentBook?.id || null,
                currentBookTitle: currentBook?.title || ''
            }, true);
        } else {
            if (currentBook) {
                currentBook.inProgress = false;
                currentBook.status = "failed";
                currentBook.generatedSteps = currentBook.steps.length;
                currentBook.updatedAt = Date.now();
                saveGalleriesToStorage();
                renderGallery();
            }
            addLog(`❌ 批量绘制过程中发生致命错误崩溃: ${err.message}`, "text-red-500 font-bold");
            setBatchRunState('failed', {
                progressLabel: '任务失败，已保留已生成图片',
                activeBookId: currentBook?.id || null,
                currentBookTitle: currentBook?.title || ''
            }, true);
            notifyError(`批量绘制中断：${err.message}`, { title: "任务失败" });
        }
    } finally {
        // 使用 finally 确保所有锁与 UI 控件百分之百在任何退出情况下正确解锁，防止重入卡死
        runningBatch = false;
        cancelRequested = false;
        document.getElementById('btn-run-batch').classList.remove('hidden');
        document.getElementById('btn-cancel-batch').classList.add('hidden');
        document.getElementById('btn-cancel-batch').classList.remove('flex');
        document.getElementById('btn-cancel-batch').disabled = false;
    }
}
