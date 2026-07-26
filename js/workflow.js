// js/workflow.js - ComfyUI 工作流的导入、切换、节点映射与持久化。

// --- TAB 4: WORKFLOW HELPERS ---
function saveWorkflowsToStorage(forceWrite = false) {
    updateLastActiveTime();
    localStorage.setItem('comfy_workflows', JSON.stringify(comfyWorkflows));
    localStorage.setItem('comfy_active_workflow_id', activeWorkflowId);
    saveConfigToComfyServer(forceWrite);
}

function renderWorkflowSelector() {
    const selector = document.getElementById('workflow-selector');
    if (!selector) return;
    selector.innerHTML = '';
    if (comfyWorkflows.length === 0) {
        selector.innerHTML = '<option value="">-- 暂无工作流，请在下方上传 --</option>';
        return;
    }
    comfyWorkflows.forEach(wf => {
        const isSelected = wf.id === activeWorkflowId ? 'selected' : '';
        selector.insertAdjacentHTML('beforeend', `
            <option value="${escapeHtml(wf.id)}" ${isSelected}>${escapeHtml(wf.name)}</option>
        `);
    });
}

function selectWorkflow(wfId, updateInputs = true) {
    if (!wfId) {
        activeWorkflowId = null;
        document.getElementById('node-select-positive').innerHTML = '<option value="">-- 请上传工作流或手动输入 --</option>';
        document.getElementById('node-select-negative').innerHTML = '<option value="">-- 请上传工作流或手动输入 --</option>';
        document.getElementById('node-select-output').innerHTML = '<option value="">-- 请上传工作流或手动输入 --</option>';
        document.getElementById('node-id-positive').value = '';
        document.getElementById('node-id-negative').value = '';
        document.getElementById('node-id-output').value = '';
        comfyWorkflowRaw = null;
        if (updateInputs) saveWorkflowsToStorage();
        return;
    }
    const wf = comfyWorkflows.find(w => w.id === wfId);
    if (!wf) return;

    activeWorkflowId = wfId;
    comfyWorkflowRaw = wf.raw;
    if (updateInputs) saveWorkflowsToStorage();

    const selector = document.getElementById('workflow-selector');
    if (selector) selector.value = wfId;

    parseAndPopulateWorkflowDropdowns(wf.raw);

    if (updateInputs) {
        document.getElementById('node-id-positive').value = wf.nodePositive || '';
        document.getElementById('node-id-negative').value = wf.nodeNegative || '';
        document.getElementById('node-id-output').value = wf.nodeOutput || '';
        
        document.getElementById('node-select-positive').value = wf.nodePositive || '';
        document.getElementById('node-select-negative').value = wf.nodeNegative || '';
        document.getElementById('node-select-output').value = wf.nodeOutput || '';
    } else {
        document.getElementById('node-id-positive').value = wf.nodePositive || '';
        document.getElementById('node-id-negative').value = wf.nodeNegative || '';
        document.getElementById('node-id-output').value = wf.nodeOutput || '';
        
        setTimeout(() => {
            document.getElementById('node-select-positive').value = wf.nodePositive || '';
            document.getElementById('node-select-negative').value = wf.nodeNegative || '';
            document.getElementById('node-select-output').value = wf.nodeOutput || '';
        }, 100);
    }
}

function updateActiveWorkflowConfig(key, value) {
    if (!activeWorkflowId) return;
    const wf = comfyWorkflows.find(w => w.id === activeWorkflowId);
    if (wf) {
        wf[key] = value;
        saveWorkflowsToStorage();
    }
}

function renameWorkflow() {
    if (!activeWorkflowId) {
        alert("请先上传或选择一个工作流！");
        return;
    }
    const wf = comfyWorkflows.find(w => w.id === activeWorkflowId);
    if (!wf) return;
    
    const newName = prompt("请输入工作流的新名称：", wf.name);
    if (newName && newName.trim()) {
        wf.name = newName.trim();
        saveWorkflowsToStorage();
        renderWorkflowSelector();
        initLucide();
    }
}

function deleteWorkflow() {
    if (!activeWorkflowId) {
        alert("请先选择要删除的工作流！");
        return;
    }
    const wf = comfyWorkflows.find(w => w.id === activeWorkflowId);
    if (!wf) return;
    
    if (confirm(`确定要删除工作流「${wf.name}」吗？`)) {
        comfyWorkflows = comfyWorkflows.filter(w => w.id !== activeWorkflowId);
        if (comfyWorkflows.length > 0) {
            activeWorkflowId = comfyWorkflows[0].id;
        } else {
            activeWorkflowId = null;
        }
        saveWorkflowsToStorage(true);
        renderWorkflowSelector();
        selectWorkflow(activeWorkflowId, true);
        initLucide();
    }
}

function handleWorkflowUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const parsed = JSON.parse(evt.target.result);
            const wfName = file.name.replace(/\.[^/.]+$/, "");
            const newId = "wf_" + Date.now();
            
            const newWf = {
                id: newId,
                name: wfName,
                raw: parsed,
                nodePositive: '6',
                nodeNegative: '',
                nodeOutput: '9'
            };
            
            comfyWorkflows.push(newWf);
            activeWorkflowId = newId;
            
            saveWorkflowsToStorage();
            renderWorkflowSelector();
            selectWorkflow(newId, true);
            initLucide();
            
            alert("ComfyUI 工作流成功导入！已添加到列表并自动切换为当前活动配置。🎉");
        } catch (err) {
            alert("解析工作流 JSON 失败，请确保格式正确且不为常规网页工作流。错误: " + err.message);
        }
        e.target.value = '';
    };
    reader.readAsText(file);
}

function parseAndPopulateWorkflowDropdowns(workflow) {
    const posSel = document.getElementById('node-select-positive');
    const negSel = document.getElementById('node-select-negative');
    const outSel = document.getElementById('node-select-output');

    posSel.innerHTML = '<option value="">-- 手动在下方填写节点ID --</option>';
    negSel.innerHTML = '<option value="">-- 手动在下方填写节点ID (可选) --</option>';
    outSel.innerHTML = '<option value="">-- 手动在下方填写节点ID --</option>';

    Object.keys(workflow).forEach(nodeId => {
        const node = workflow[nodeId];
        const type = node.class_type || '';
        
        let displayName = `节点 [${nodeId}] - ${type}`;
        if (node._meta?.title) displayName += ` (${node._meta.title})`;

        if (type.includes('CLIPTextEncode') || type.includes('CLIPText') || type.includes('Text')) {
            posSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(nodeId)}">${escapeHtml(displayName)}</option>`);
            negSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(nodeId)}">${escapeHtml(displayName)}</option>`);
        }

        if (type.includes('Save') || type.includes('Preview') || type.includes('Image') || type.includes('Output')) {
            outSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(nodeId)}">${escapeHtml(displayName)}</option>`);
        }
    });

    posSel.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('node-id-positive').value = val;
        syncComfyConfigToLocalStorage(getComfyConfigFromDom());
        updateActiveWorkflowConfig('nodePositive', val);
        if (!activeWorkflowId) saveComfyConfigFromDom();
    });
    negSel.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('node-id-negative').value = val;
        syncComfyConfigToLocalStorage(getComfyConfigFromDom());
        updateActiveWorkflowConfig('nodeNegative', val);
        if (!activeWorkflowId) saveComfyConfigFromDom();
    });
    outSel.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('node-id-output').value = val;
        syncComfyConfigToLocalStorage(getComfyConfigFromDom());
        updateActiveWorkflowConfig('nodeOutput', val);
        if (!activeWorkflowId) saveComfyConfigFromDom();
    });
}
