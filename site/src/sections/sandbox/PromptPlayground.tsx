import { useId, useState } from 'react';
import type { SectionProps } from '../../shared/types';

type Variable = 'character' | 'outfit' | 'mood' | 'scene';
type Preset = { value: string; 'zh-CN': string; en: string };

const presets: Record<Variable, Preset[]> = {
  character: [
    {
      'zh-CN': '海边送信人',
      en: 'The letter carrier',
      value: 'a young letter carrier with short dark hair',
    },
    {
      'zh-CN': '旧书店店主',
      en: 'The bookseller',
      value: 'a silver-haired bookseller with round glasses',
    },
    {
      'zh-CN': '远行的画家',
      en: 'The travelling artist',
      value: 'a travelling artist with a loose braid',
    },
  ],
  outfit: [
    { 'zh-CN': '米色风衣', en: 'A linen coat', value: 'a loose beige linen coat' },
    {
      'zh-CN': '靛蓝工作服',
      en: 'An indigo jacket',
      value: 'an indigo work jacket with rolled sleeves',
    },
    { 'zh-CN': '暖白针织衫', en: 'An ivory sweater', value: 'a soft ivory knitted sweater' },
  ],
  mood: [
    {
      'zh-CN': '安静期待',
      en: 'Quiet anticipation',
      value: 'quietly hopeful, looking into the distance',
    },
    { 'zh-CN': '如释重负', en: 'A sense of relief', value: 'relieved, with a small gentle smile' },
    { 'zh-CN': '若有所思', en: 'Lost in thought', value: 'thoughtful, holding an unopened letter' },
  ],
  scene: [
    { 'zh-CN': '雨后海边', en: 'The coast', value: 'a seaside town after the rain' },
    {
      'zh-CN': '午后书店',
      en: 'The bookshop',
      value: 'a sunlit second-hand bookshop in the afternoon',
    },
    { 'zh-CN': '黄昏车站', en: 'The station', value: 'a quiet railway station at dusk' },
  ],
};

const initialTemplate =
  'A quiet comic panel of {character}, wearing {outfit}, {mood}, at {scene}. Soft watercolor, expressive linework, no lettering.';
const variables: Variable[] = ['character', 'outfit', 'mood', 'scene'];

const copy = {
  'zh-CN': {
    eyebrow: '同一个分镜，留出不同的可能',
    title: '把设定放进花括号。',
    intro: '选一组示例预设，看看提示词如何展开。这里展示文本装配；已有画面不会随预设换人。',
    character: '角色',
    outfit: '服装',
    mood: '情绪',
    scene: '场景',
    override: '本幕情绪覆盖',
    optional: '可选，例如：a little nervous, holding a letter',
    overrideHint: '本幕填写的值优先；留空则沿用情绪预设。',
    template: '输入模板',
    reset: '恢复示例',
    result: '展开后的提示词',
    resultNote: '高亮部分来自变量替换。没有发起生图请求。',
    sources: '本幕使用的值与来源',
    sourceLabels: {
      character: '角色预设',
      outfit: '服装预设',
      mood: '情绪预设',
      scene: '场景选择',
    },
    overrideSource: '本幕覆盖',
    sample: '示例值 · 可修改输入模板',
    unknown: '有未匹配的变量，请检查花括号内的名称。',
  },
  en: {
    eyebrow: 'One storyboard, room for possibility',
    title: 'Put your ideas in braces.',
    intro:
      'Choose a sample preset and watch the prompt take shape. This is text assembly; existing artwork stays the same.',
    character: 'Character',
    outfit: 'Outfit',
    mood: 'Mood',
    scene: 'Setting',
    override: 'Mood override for this panel',
    optional: 'Optional, e.g. a little nervous, holding a letter',
    overrideHint: 'A panel override takes priority. Leave it empty to use the mood preset.',
    template: 'Input template',
    reset: 'Reset sample',
    result: 'Resolved prompt',
    resultNote: 'Highlighted words come from variables. No image request is sent.',
    sources: 'Values and sources for this panel',
    sourceLabels: {
      character: 'Character preset',
      outfit: 'Outfit preset',
      mood: 'Mood preset',
      scene: 'Setting selection',
    },
    overrideSource: 'Panel override',
    sample: 'Sample values · The input template is editable',
    unknown: 'An unmatched variable remains. Check the name inside the braces.',
  },
};

export function PromptPlayground({ locale }: SectionProps) {
  const text = copy[locale];
  const id = useId();
  const [selected, setSelected] = useState<Record<Variable, number>>({
    character: 0,
    outfit: 0,
    mood: 0,
    scene: 0,
  });
  const [override, setOverride] = useState('');
  const [template, setTemplate] = useState(initialTemplate);
  const values: Record<Variable, string> = {
    character: presets.character[selected.character].value,
    outfit: presets.outfit[selected.outfit].value,
    mood: override.trim() || presets.mood[selected.mood].value,
    scene: presets.scene[selected.scene].value,
  };
  const parts = template.split(/(\{[^{}]+\})/g);
  const unresolved = parts.some(
    (part) => /^\{[^{}]+\}$/.test(part) && !variables.includes(part.slice(1, -1) as Variable),
  );

  return (
    <div className="sandbox-prompt">
      <div className="sandbox-demo-heading">
        <p className="eyebrow">{text.eyebrow}</p>
        <h3>{text.title}</h3>
        <p>{text.intro}</p>
      </div>
      <div className="sandbox-prompt-grid">
        <div className="sandbox-preset-form">
          <p className="sandbox-preset-sample">{text.sample}</p>
          <div className="sandbox-preset-selects">
            {(['character', 'outfit', 'mood'] as const).map((key) => (
              <label key={key} htmlFor={`${id}-${key}`}>
                <span>
                  {text[key]} <code>{`{${key}}`}</code>
                </span>
                <select
                  id={`${id}-${key}`}
                  value={selected[key]}
                  onChange={(event) =>
                    setSelected({ ...selected, [key]: Number(event.target.value) })
                  }
                >
                  {presets[key].map((item, index) => (
                    <option key={item.value} value={index}>
                      {item[locale]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <fieldset className="sandbox-scene-picker">
            <legend>
              {text.scene} <code>{'{scene}'}</code>
            </legend>
            <div>
              {presets.scene.map((item, index) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={selected.scene === index}
                  onClick={() => setSelected({ ...selected, scene: index })}
                >
                  {item[locale]}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="sandbox-override" htmlFor={`${id}-override`}>
            <span>{text.override}</span>
            <input
              id={`${id}-override`}
              value={override}
              onChange={(event) => setOverride(event.target.value)}
              placeholder={text.optional}
              aria-describedby={`${id}-override-hint`}
            />
          </label>
          <p className="sandbox-field-hint" id={`${id}-override-hint`}>
            {text.overrideHint}
          </p>
          <div className="sandbox-template-label">
            <label htmlFor={`${id}-template`}>{text.template}</label>
            <button type="button" onClick={() => setTemplate(initialTemplate)}>
              {text.reset} ↺
            </button>
          </div>
          <textarea
            id={`${id}-template`}
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
            rows={5}
            spellCheck={false}
          />
        </div>
        <div className="sandbox-prompt-result">
          <div className="sandbox-prompt-result-heading">
            <span className="sandbox-status-dot" aria-hidden="true" />
            <h4>{text.result}</h4>
            <span aria-hidden="true">TXT</span>
          </div>
          <output className="sandbox-resolved-prompt" aria-label={text.result}>
            {parts.map((part, index) => {
              const key = part.slice(1, -1) as Variable;
              if (/^\{[^{}]+\}$/.test(part)) {
                return variables.includes(key) ? (
                  <mark key={index} title={`{${key}}`}>
                    {values[key]}
                  </mark>
                ) : (
                  <span className="sandbox-unresolved" key={index}>
                    {part}
                  </span>
                );
              }
              return <span key={index}>{part}</span>;
            })}
          </output>
          <p className="sandbox-result-note">{text.resultNote}</p>
          {unresolved && (
            <p className="sandbox-unresolved-note" role="status">
              {text.unknown}
            </p>
          )}
          <div className="sandbox-source-list">
            <h4>{text.sources}</h4>
            <dl>
              {variables.map((key) => (
                <div key={key} data-testid={`sandbox-source-${key}`}>
                  <dt>
                    <code>{`{${key}}`}</code>
                    <span>
                      {key === 'mood' && override.trim()
                        ? text.overrideSource
                        : text.sourceLabels[key]}
                    </span>
                  </dt>
                  <dd>{values[key]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
