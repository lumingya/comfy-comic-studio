// js/batch.js - 批量出图流水线：任务编排、进度、取消与失败降级。

// --- TAB 3: DECOUPLED IMAGE DRAWING PIPELINE ---
async function cancelBatchGeneration() {
    const canControlPersistedRun = batchRunState.status === 'active' || batchRunState.status === 'stale';
    if (!runningBatch && !canControlPersistedRun) return;

    cancelRequested = true;
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
        alert("所选模板不存在！");
        return;
    }

    const activeRows = batchMatrix.rows.filter(r => r.active);
    if (activeRows.length === 0) {
        alert("当前没有勾选启用的角色。请在表格左侧勾选至少一行。");
        return;
    }

    if (!isMockMode) {
        const posNodeId = document.getElementById('node-id-positive').value.trim();
        const outNodeId = document.getElementById('node-id-output').value.trim();
        if (!posNodeId || !outNodeId) {
            alert("生产模式下，必须指定积极提示词节点和图像输出节点ID！请前往【工作流设置】进行配置。");
            return;
        }
        if (!comfyWorkflowRaw) {
            alert("生产模式下，必须上传 ComfyUI 导出的 API JSON 工作流文件！");
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
                synopsis: (document.getElementById('global-story-prompt') ? document.getElementById('global-story-prompt').value : null) || `利用公式《${tpl.title}》创作而成的精美组图。`,
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
                renderGallery();

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
        alert("批量图片绘制成功！");
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
            alert(`批量绘制失败: ${err.message}`);
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
