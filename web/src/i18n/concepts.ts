export const conceptDocs = {
  profiles: 'workflow.html#advanced-render-plans',
  mappings: 'workflow.html#slot-mappings',
  lora: 'workflow.html#lora-controls',
  editableExport: 'files.html#editable-exports',
  imageProfiles: 'read-and-share.html#section-1',
  safeMode: 'sharing.html#safe-mode',
  apiScopes: 'sharing.html#token-scopes',
  webhooks: 'sharing.html#webhooks',
} as const;

export const conceptsEn = {
  tutorial: 'Open the illustrated guide',
  profiles: {
    label: 'About advanced render plans',
    description:
      'Choose a local workflow or a cloud service for everyday generation. Use an advanced plan to run several workflows in order, such as drawing a draft and then refining it at a higher resolution.',
  },
  mappings: {
    label: 'About slot mappings and adapters',
    description:
      'Mappings tell Mio which workflow input receives a value like the prompt. When a custom node stores its controls differently, an adapter can help Mio read and write them.',
  },
  lora: {
    label: 'About individual LoRA overrides',
    description:
      'Each LoRA can be turned off or adjusted separately. Settings for this task leave the workflow defaults intact, and a panel setting takes priority for that panel.',
  },
  editableExport: {
    label: 'About editable files and creation kits',
    description:
      'Choose an editable source file to continue working on this album in another workspace. Choose a creation kit to reuse selected storyboards, presets, and generation settings in a new work.',
  },
  imageProfiles: {
    label: 'About image processing options',
    description:
      'Auto balances quality and size. Lossless clean removes metadata, Light publish makes smaller files, and Lossless archive can retain the original files and their metadata.',
  },
  safeMode: {
    label: 'About extension safe mode',
    description:
      'Safe mode starts Mio with extensions unloaded. Use it if an extension is blocking startup or you want to check whether an issue comes from an extension.',
  },
  apiScopes: {
    label: 'About API token scopes',
    description:
      'Scopes limit what a connected program can do. For example, give a program that only lists albums permission to read, and grant more access only when it needs it.',
  },
  webhooks: {
    label: 'About webhooks',
    description:
      'A webhook notifies a connected program when something happens in Mio, such as a generation finishing. That program provides an address to receive the notifications.',
  },
};

export const conceptsZh = {
  tutorial: '查看图文教程',
  profiles: {
    label: '了解高级出图方案',
    description:
      '日常出图直接选本地工作流或云端服务即可。需要按顺序运行多个工作流时，例如先出草图，再放大细化，就用高级出图方案。',
  },
  mappings: {
    label: '了解槽位映射与适配器',
    description:
      '映射告诉 Mio 把提示词等内容填进工作流的哪个输入框。如果自定义节点用特殊方式保存参数，可以用适配器帮助 Mio 读写这些参数。',
  },
  lora: {
    label: '了解独立 LoRA 覆写',
    description:
      '每颗 LoRA 都可以单独关闭或调权重。本次任务的设置会保留工作流默认值，其中某一幕也可以再用自己的设置。',
  },
  editableExport: {
    label: '了解可编辑源文件与创作套装',
    description:
      '想在另一个工作区继续编辑这本画册，选可编辑源文件。想让新的作品沿用所选分镜、预设和出图配置，选创作套装。',
  },
  imageProfiles: {
    label: '了解图片处理档位',
    description:
      '自动档兼顾画质和体积。无损清洗可去除图片元数据，轻量发布会缩小文件，无损归档可保留原图及其元数据。',
  },
  safeMode: {
    label: '了解扩展安全模式',
    description:
      '安全模式下，Mio 启动时会跳过扩展。遇到扩展卡住启动，或想确认问题是否由扩展引起时，可以使用它。',
  },
  apiScopes: {
    label: '了解 API 令牌作用域',
    description:
      '作用域限制外部程序能做哪些事。例如，只列出画册的程序给它读取权限即可，等它需要其他操作时再增加相应权限。',
  },
  webhooks: {
    label: '了解 Webhook',
    description:
      '当生成完成等事件发生时，Webhook 会主动通知其他程序。接收方需要提供一个地址来接收通知。',
  },
};
