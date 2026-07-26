// llm.js - 大语言模型剧情旁白生成器

const DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT = `你是一个专业的成人本子/漫画分镜策划师。请根据用户的主题构思和总幕数要求，为他设计一个连环画模板。
为了方便解析，必须完全使用 XML 格式返回，并且不能包含任何 Markdown 代码块（如 \`\`\`xml 或 \`\`\` 标记），也不要包含任何多余的解释、对话或包裹文本，直接输出纯 XML 文本。
XML 根标签为 <模板>，格式规范严格如下：
<模板>
  <标题>模板的中文标题</标题>
  <简介>模板简介，描述该本子的整体涩涩主线</简介>
  <分镜列表>
    <分镜1>
      <名称>第一幕：名称</名称>
      <提示词>当前幕画面英文提示词，必须包含至少一个人物占位符变量（如 {character}、{character1}、{character2}）、{style} 以及可选的 {outfit}</提示词>
      <剧情>当前幕的中文剧情内容/台词，可以使用人物占位符变量（如 {character}、{character1}、{character2}）</剧情>
    </分镜1>
    ... (一共正好有 {panelCount} 个 <分镜1> 到 <分镜xxx> 标签)
  </分镜列表>
</模板>

提示词要求：画面的英文提示词中必须合理嵌入人物变量、{style} 和可选的 {outfit}，人物变量可以按角色数量自定义为 {character}、{character1}、{character2} 等，用大括号包裹，供系统替换。例如: "A beautiful raw photo of {character1} standing beside {character2}, {style}, wearing {outfit}, cinematic lighting..."`;

window.DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT = DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT;

const LLM_REQUEST_TIMEOUT_MS = 120000;

function getLlmChatCompletionsUrl(baseUrl) {
    return `${String(baseUrl || '').replace(/\/+$/, '')}/chat/completions`;
}

async function fetchLlmWithTimeout(resource, options = {}) {
    const { timeout = LLM_REQUEST_TIMEOUT_MS, signal: externalSignal, ...fetchOptions } = options;
    const controller = new AbortController();
    let timedOut = false;
    const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);

    if (externalSignal?.aborted) {
        abortFromExternalSignal();
    } else {
        externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
    }

    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeout);

    try {
        return await fetch(resource, { ...fetchOptions, signal: controller.signal });
    } catch (err) {
        if (err.name === 'AbortError' && timedOut) {
            throw new Error(`LLM 请求超时（${Math.round(timeout / 1000)} 秒），请检查服务地址或稍后重试。`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
        externalSignal?.removeEventListener('abort', abortFromExternalSignal);
    }
}

async function getLlmResponseError(res) {
    try {
        const errData = await res.json();
        return errData.error?.message || errData.message || `HTTP ${res.status}`;
    } catch (err) {
        return `${res.statusText || 'LLM 请求失败'} (HTTP ${res.status})`;
    }
}

function resolveXmlTemplateSystemPrompt(systemPromptTemplate, panelCount) {
    const source = (systemPromptTemplate || DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT).trim() || DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT;
    return source.replace(/\{\{panelCount\}\}|\{panelCount\}/g, String(panelCount));
}

window.resolveXmlTemplateSystemPrompt = resolveXmlTemplateSystemPrompt;

// Real LLM fetch client connection for generating story continuity panel by panel (fallback mode)
async function requestLlmContinuity(globalOutline, currentPrompt, previousContext, currentStepIdx, totalSteps) {
    const baseUrl = document.getElementById('llm-base-url').value.trim();
    const apiKey = document.getElementById('llm-api-key').value.trim();
    const model = document.getElementById('llm-model-name').value.trim();
    const systemPrompt = document.getElementById('llm-system-prompt').value.trim();

    const userPrompt = `
【画册总纲核心背景】：
${globalOutline || "暂无预设大纲背景"}

【已发生剧情前情回顾】：
${previousContext || "当前是故事的第一幕，暂无前置剧情。"}

【当前幕第 ${currentStepIdx}/${totalSteps} 幕 图像构图提示词细节】：
${currentPrompt}

请根据上面的要素，创作当前这一幕的字幕旁白。
    `;

    const res = await fetchLlmWithTimeout(getLlmChatCompletionsUrl(baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.8,
            max_tokens: 150
        })
    });

    if (res.ok) {
        const data = await res.json();
        return data.choices[0].message.content.trim();
    } else {
        throw new Error(await getLlmResponseError(res));
    }
}

// Real LLM fetch client connection for generating all captions at once (decoupled / one-shot mode)
async function requestLlmAllCaptions(globalOutline, preparedPanels, bookTitle) {
    const baseUrl = document.getElementById('llm-base-url').value.trim();
    const apiKey = document.getElementById('llm-api-key').value.trim();
    const model = document.getElementById('llm-model-name').value.trim();
    const systemPrompt = `你是一个专业的 R18 成人本子/同人漫画剧情策划和编剧。请根据用户提供的大纲和每一幕分镜的画面提示词，一次性为所有分镜创作符合 R18 本子风格的生动剧情文案（包含角色的生动对话、心理活动或大胆露骨的涩涩场景描写）。
请注意：不要是高高在上的旁白，而是生动的、代入感极强的台词或剧情段落。
请严格输出为 JSON 数组格式（字符串数组，每项对应一幕），且元素个数必须正好等于分镜数量。例如分镜为 4 幕时，必须返回：
["第一幕剧情台词...", "第二幕剧情台词...", "第三幕剧情台词...", "第四幕剧情台词..."]
不要带有任何 markdown 格式标记（不要写 \`\`\`json 标签），也不要包含任何额外的解释或对话。`;

    const stepsText = preparedPanels.map((p, i) => `【第 ${i+1} 幕 · ${p.name}】\n画面提示词：${p.prompt}`).join('\n\n');
    
    const userPrompt = `
【故事标题】：${bookTitle}
【故事主线大纲】：${globalOutline || "暂无大纲"}

分镜图像提示词列表如下：
${stepsText}

请直接返回对应的 JSON 字符串数组，数组中必须正好包含 ${preparedPanels.length} 个元素。`;

    const res = await fetchLlmWithTimeout(getLlmChatCompletionsUrl(baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.85
        })
    });

    if (res.ok) {
        const data = await res.json();
        const content = data.choices[0].message.content.trim();
        const cleanContent = content.replace(/```json/g, "").replace(/```/g, "").trim();
        try {
            const parsed = JSON.parse(cleanContent);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch(e) {
            console.error("JSON parse error, raw content:", content, e);
        }
        throw new Error("模型返回的内容无法解析为有效的 JSON 数组");
    } else {
        throw new Error(await getLlmResponseError(res));
    }
}

// Mock LLM Script writer generator
function simulateLlmStoryline(bookTitle, stepName, stepIndex) {
    const scripts = [
        `在无尽的数据与星云包围中，命运齿轮缓缓转动。她怀揣着秘密的火种独自前行。`,
        `突然间，律动的霓虹仿佛受到了古老的感召，她在光芒的涟漪中肆意挥洒星尘。`,
        `华美的礼服背后凝聚着觉醒的力量，在虚无而盛大的殿堂中央，一曲终了。`,
        `疲惫的身影终将靠港。深邃的夜幕如同永恒的守护者，在轻吟着遥远的歌谣将她送入梦境。`
    ];
    return `【${bookTitle}】${scripts[stepIndex % scripts.length]}`;
}

// Real LLM fetch client connection for generating scripts in chunks (split story board support)
async function requestLlmChunkCaptions(globalOutline, chunkPanels, bookTitle, startIdx, allFinishedCaptions) {
    const baseUrl = document.getElementById('llm-base-url').value.trim();
    const apiKey = document.getElementById('llm-api-key').value.trim();
    const model = document.getElementById('llm-model-name').value.trim();
    
    const previousHistory = allFinishedCaptions.map((c, i) => `【分镜 ${i+1} 旁白】：${c}`).join('\n');
    const chunkDetails = chunkPanels.map((p, i) => `【分镜 ${startIdx + i + 1} · ${p.name}】\n画面提示词：${p.prompt}`).join('\n\n');

    const systemPrompt = `你是一个专业的 R18 成人本子编剧专家。请为本子分段创作连贯的大胆剧情与角色台词/心理。
请注意：不要是旁白，而是富有张力和代入感的剧情、对话和娇喘细节。
请严格输出为 JSON 数组格式（字符串数组，每项对应一幕），且元素个数必须正好等于当前这一批次分镜的数量。例如这一批包含 3 幕时，必须返回：
["第 ${startIdx + 1} 幕剧情...", "第 ${startIdx + 2} 幕剧情...", "第 ${startIdx + 3} 幕剧情..."]
不要带有任何 markdown 格式标记，也不要包含任何额外的解释或对话。`;

    const userPrompt = `
【故事标题】：${bookTitle}
【全局大纲】：${globalOutline || "暂无"}

【前情已生成好的旁白回顾（请务必在剧情、语气和节奏上保持高度连贯性）】：
${previousHistory || "这是故事的开篇。"}

【当前批次需要生成的 ${chunkPanels.length} 个分镜】：
${chunkDetails}

请直接返回对应的 JSON 字符串数组，数组中必须正好包含 ${chunkPanels.length} 个元素。`;

    const res = await fetchLlmWithTimeout(getLlmChatCompletionsUrl(baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.8
        })
    });

    if (res.ok) {
        const data = await res.json();
        const content = data.choices[0].message.content.trim();
        const cleanContent = content.replace(/```json/g, "").replace(/```/g, "").trim();
        try {
            const parsed = JSON.parse(cleanContent);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch(e) {
            console.error("JSON parse error for chunk, raw content:", content, e);
        }
        throw new Error("大模型返回的内容无法解析为当前批次的 JSON 数组");
    } else {
        throw new Error(await getLlmResponseError(res));
    }
}

// Real LLM fetch client connection for designing a template in XML format
async function requestXmlTemplateFromLlm(userIdea, panelCount, provider, apiKey, model, baseUrl, systemPromptTemplate = DEFAULT_XML_TEMPLATE_SYSTEM_PROMPT) {
    if (!apiKey) {
        throw new Error("API Key 密钥不能为空，请在配置面板中输入！");
    }

    const systemPrompt = resolveXmlTemplateSystemPrompt(systemPromptTemplate, panelCount);

    const userPrompt = `我想要的主题是：${userIdea}
    目标总分镜幕数：${panelCount} 幕。
    请立即为我设计这个 XML 模板！`;

    const res = await fetchLlmWithTimeout(getLlmChatCompletionsUrl(baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.8
        })
    });

    if (res.ok) {
        const data = await res.json();
        return data.choices[0].message.content.trim();
    } else {
        throw new Error(await getLlmResponseError(res));
    }
}

// ==========================================
// AI 聊天精修 - Function Calling 注册及请求
// ==========================================

const DEFAULT_CHAT_REFINEMENT_SYSTEM_PROMPT = `你是一个内置于连环画漫画生成器（ComfyComic Studio）的智能精修助手。你的任务是根据用户的指令直接或者间接调整当前的连环画漫画模板。
你拥有一些工具，能够帮助你获取当前模板状态并执行修改操作（如修改标题、大纲、分镜名称、分镜绘图Prompt、剧情Caption、以及添加/删除/调整分镜顺序）。
交互原则：
1. 始终优先调用 get_current_template_details 工具来获取当前的漫画模板状态，如果用户要求修改或者微调的话。
2. 当用户命令你修改任何内容时，如果有对应的工具可以调用，请【立即调用】该工具执行修改。不要纸上谈兵只输出文字，而是切实去调用工具！
3. 如果工具调用返回的结果有错误，请在你的最终中文回复里以人类可读的形式进行总结。
4. 如果修改已成功完成，请在中文回复中告知用户修改了什么，以及新的大纲或分镜长什么样，提醒用户在主界面查看。
5. 永远严格保护大括号包裹的变量（如 {character}, {character1}, {character2}, {style}, {outfit} 等占位符）！不要破坏它们，因为这些是系统批量生图和文本替换的命脉！
6. 如果用户需要进行整体风格美化（如画面提示词超分细节润色、剧情文案语气大改等），可以使用 batch_update_prompts_and_captions 或循环调用 update_frame_prompt_and_caption 工具来实现。
7. 用简洁友好的中文与用户交流。`;

function getChatRefinementSystemPrompt() {
    const storedPrompt = localStorage.getItem('comfy_comic_chat_system_prompt') || '';
    return storedPrompt.trim() || DEFAULT_CHAT_REFINEMENT_SYSTEM_PROMPT;
}

function buildChatContentForApi(msg) {
    const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
    const baseText = msg.content || '';
    if (attachments.length === 0) {
        return baseText || null;
    }

    const textParts = [baseText].filter(Boolean);
    const imageParts = [];

    attachments.forEach((att, idx) => {
        const label = `附件 ${idx + 1}：${att.name || '未命名文件'}`;
        if (att.kind === 'image' && att.dataUrl) {
            textParts.push(`[${label}] 图片已随消息上传，请结合图片内容理解用户意图。`);
            imageParts.push({
                type: 'image_url',
                image_url: { url: att.dataUrl }
            });
        } else if (att.text) {
            textParts.push(`[${label}]\n${att.text}`);
        } else {
            textParts.push(`[${label}] 文件已上传，但未能提取文本内容。`);
        }
    });

    const textContent = textParts.join('\n\n') || '请参考附件内容。';
    if (imageParts.length === 0) {
        return textContent;
    }

    return [
        { type: 'text', text: textContent },
        ...imageParts
    ];
}

const CHAT_REFINEMENT_TOOLS = [
    {
        type: "function",
        function: {
            name: "get_current_template_details",
            description: "获取当前用户正在编辑的漫画模板的全局信息以及所有分镜列表数据"
        }
    },
    {
        type: "function",
        function: {
            name: "update_template_title",
            description: "更新当前漫画模板的标题",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string", description: "新的中文模板标题" }
                },
                required: ["title"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "update_template_outline",
            description: "更新当前漫画模板的整体剧情主线思路大纲",
            parameters: {
                type: "object",
                properties: {
                    outline: { type: "string", description: "新的中文剧情主线描述/大纲/简介" }
                },
                required: ["outline"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "update_frame_prompt_and_caption",
            description: "更新指定某一步分镜的英文绘图提示词(Prompt)和中文剧情台词(Caption)",
            parameters: {
                type: "object",
                properties: {
                    frameIndex: { type: "integer", description: "分镜幕的索引值，0-indexed。例如：第一幕对应 0，第二幕对应 1，以此类推。" },
                    name: { type: "string", description: "可选。该幕的中文新名称，例如 '第一幕：深夜回家'" },
                    prompt: { type: "string", description: "可选。更新后的英文绘图提示词，必须合理嵌入可自定义人物变量（如 {character}, {character1}, {character2}）、{style}, {outfit} 等占位符" },
                    caption: { type: "string", description: "可选。更新后的中文剧情台词，可以使用可自定义人物变量（如 {character1}, {character2}）" }
                },
                required: ["frameIndex"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "add_new_frame",
            description: "在当前模板中添加一幕全新的分镜。可以选择插入位置，默认追加到末尾。",
            parameters: {
                type: "object",
                properties: {
                    insertIndex: { type: "integer", description: "插入的索引位置，0-indexed。如果省略，则默认追加到当前所有分镜的末尾。" },
                    name: { type: "string", description: "新一幕的中文名称，例如 '第三幕：突发危机'" },
                    prompt: { type: "string", description: "新一幕的英文绘图提示词，必须合理嵌入可自定义人物变量（如 {character}, {character1}, {character2}）、{style}, {outfit} 等占位符" },
                    caption: { type: "string", description: "新一幕的中文剧情台词，可以使用可自定义人物变量（如 {character1}, {character2}）" }
                },
                required: ["name", "prompt", "caption"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "delete_frame",
            description: "删除当前模板中的某一幕分镜",
            parameters: {
                type: "object",
                properties: {
                    frameIndex: { type: "integer", description: "要删除的分镜幕索引，0-indexed" }
                },
                required: ["frameIndex"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "swap_frames",
            description: "交换当前模板中两幕分镜的顺序",
            parameters: {
                type: "object",
                properties: {
                    indexA: { type: "integer", description: "第一个分镜的索引，0-indexed" },
                    indexB: { type: "integer", description: "第二个分镜的索引，0-indexed" }
                },
                required: ["indexA", "indexB"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "batch_update_prompts_and_captions",
            description: "批量一次性更新当前模板中所有分镜的 Prompt 或 Caption。适用于做全局风格重塑或语言整理。",
            parameters: {
                type: "object",
                properties: {
                    frames: {
                        type: "array",
                        description: "包含每一幕修改内容的数组，其长度必须和当前分镜总数一致，顺序也一致",
                        items: {
                            type: "object",
                            properties: {
                                frameIndex: { type: "integer", description: "分镜索引，0-indexed" },
                                prompt: { type: "string", description: "可选。更新后的英文提示词，必须使用可自定义人物变量（如 {character}, {character1}, {character2}）、{style}, {outfit} 等占位符" },
                                caption: { type: "string", description: "可选。更新后的中文剧情台词，可以使用可自定义人物变量（如 {character1}, {character2}）" }
                            },
                            required: ["frameIndex"]
                        }
                    }
                },
                required: ["frames"]
            }
        }
    }
];

window.CHAT_REFINEMENT_TOOLS = CHAT_REFINEMENT_TOOLS;

async function requestLlmChatWithTools(messages, options = {}) {
    const baseUrl = document.getElementById('llm-base-url').value.trim();
    const apiKey = document.getElementById('llm-api-key').value.trim();
    const model = document.getElementById('llm-model-name').value.trim();

    if (!apiKey) {
        throw new Error("API Key 密钥未配置，请先在 LLM 剧情与模板面板中输入并保存！");
    }

    const systemPrompt = getChatRefinementSystemPrompt();

    // 组装完整的消息流
    const visibleMessages = messages.filter(msg => !(
        msg.role === 'assistant'
        && !msg.tool_calls
        && !(msg.content || '').trim()
    ));

    const formattedMessages = [
        { role: 'system', content: systemPrompt },
        ...visibleMessages.map(msg => ({
            role: msg.role,
            content: buildChatContentForApi(msg),
            tool_calls: msg.tool_calls || undefined,
            name: msg.name || undefined,
            tool_call_id: msg.tool_call_id || undefined
        }))
    ];

    const bodyData = {
        model: model,
        messages: formattedMessages,
        temperature: 0.7,
        tools: CHAT_REFINEMENT_TOOLS,
        tool_choice: "auto"
    };

    const res = await fetchLlmWithTimeout(getLlmChatCompletionsUrl(baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        signal: options.signal,
        body: JSON.stringify(bodyData)
    });

    if (res.ok) {
        const data = await res.json();
        return data.choices[0].message;
    } else {
        throw new Error(await getLlmResponseError(res));
    }
}

window.requestLlmChatWithTools = requestLlmChatWithTools;
window.DEFAULT_CHAT_REFINEMENT_SYSTEM_PROMPT = DEFAULT_CHAT_REFINEMENT_SYSTEM_PROMPT;
window.getChatRefinementSystemPrompt = getChatRefinementSystemPrompt;
