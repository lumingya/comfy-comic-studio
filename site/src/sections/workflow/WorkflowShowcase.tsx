import { useId, useState } from 'react';
import type { SectionProps } from '../../shared/types';
import { workflowCopy } from './copy';
import './workflow.css';
import './workflow-responsive.css';

type Topic = 0 | 1 | 2;
type NodeId = 'scene' | 'mapping' | 'engine' | 'model' | 'lora' | 'output';

const topicNodes: Record<Topic, NodeId[]> = {
  0: ['scene', 'mapping', 'engine', 'output'],
  1: ['model', 'lora', 'engine', 'output'],
  2: ['engine', 'output'],
};

export function WorkflowShowcase({ locale }: SectionProps) {
  const c = workflowCopy[locale];
  const [topic, setTopic] = useState<Topic>(0);
  const [source, setSource] = useState<'local' | 'cloud'>('local');
  const [loraEnabled, setLoraEnabled] = useState(true);
  const [weight, setWeight] = useState(0.7);
  const id = useId();
  const isLocal = source === 'local';
  const effectiveLora = isLocal && loraEnabled;
  const active = (node: NodeId) =>
    topicNodes[topic].includes(node) &&
    !(!isLocal && (node === 'model' || node === 'lora')) &&
    !(node === 'lora' && !loraEnabled);
  const nodeClass = (node: NodeId) =>
    `wf-node wf-node--${node}${active(node) ? ' is-active' : ''}${
      (!isLocal && (node === 'model' || node === 'lora')) || (node === 'lora' && !loraEnabled)
        ? ' is-bypassed'
        : ''
    }`;
  const nodeProps = (node: NodeId, selectedTopic: Topic, label: string) => ({
    type: 'button' as const,
    className: nodeClass(node),
    'aria-label': `${c.nodes.inspect} ${label}`,
    'aria-pressed': topic === selectedTopic,
    onClick: () => setTopic(selectedTopic),
    'data-node': node,
  });
  const lineClass = (line: 'mapping' | 'lora' | 'output' | 'bypass') => {
    const highlighted =
      (line === 'mapping' && topic === 0) ||
      (line === 'lora' && topic === 1 && effectiveLora) ||
      (line === 'bypass' && topic === 1 && isLocal && !loraEnabled) ||
      line === 'output';
    return `wf-path${highlighted ? ' is-active' : ''}`;
  };

  return (
    <section id="workflow" className="workflow section-shell" aria-labelledby={`${id}-title`}>
      <div className="wf-intro">
        <p className="eyebrow">{c.eyebrow}</p>
        <h2 id={`${id}-title`} className="section-title wf-title">
          {c.title.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h2>
        <p className="section-copy wf-intro-copy">{c.intro}</p>
        <div className="wf-topics" aria-label={c.figure}>
          {c.topics.map((item, index) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={topic === index}
              aria-controls={`${id}-description`}
              onClick={() => setTopic(index as Topic)}
            >
              <span className="wf-topic-number" aria-hidden="true">
                0{index + 1}
              </span>
              <span>{item.label}</span>
              <span className="wf-topic-arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </div>
        <div id={`${id}-description`} className="wf-description" aria-live="polite">
          <h3>{c.topics[topic].title}</h3>
          <p>{c.topics[topic].body}</p>
        </div>
      </div>

      <figure className="wf-figure">
        <figcaption className="wf-figure-heading">
          <span>{c.figure}</span>
          <span className="wf-figure-mark" aria-hidden="true">
            M / 03
          </span>
        </figcaption>
        <div className="wf-source" role="group" aria-label={c.sourceLabel}>
          {(['local', 'cloud'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={source === value}
              onClick={() => {
                setSource(value);
                setTopic(2);
              }}
            >
              <span aria-hidden="true" className="wf-source-dot" />
              {c[value]}
            </button>
          ))}
        </div>

        <div className={`wf-map${isLocal ? '' : ' is-cloud'}`} data-source={source}>
          <svg
            className="wf-connections"
            viewBox="0 0 720 300"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path className={lineClass('mapping')} d="M 110 70 H 610" />
            {isLocal && (
              <>
                <path className={lineClass('lora')} d="M 110 230 H 360 V 152 H 610 V 70" />
                {!loraEnabled && (
                  <path className={lineClass('bypass')} d="M 110 230 V 152 H 610 V 70" />
                )}
              </>
            )}
            <path className={lineClass('output')} d="M 610 70 V 230" />
          </svg>

          <button {...nodeProps('scene', 0, c.nodes.scene)}>
            <span className="wf-node-number">01</span>
            <span className="wf-node-title">{c.nodes.scene}</span>
            <span className="wf-node-detail">{c.nodes.sceneDetail}</span>
          </button>
          <button {...nodeProps('mapping', 0, c.topics[0].label)}>
            <span className="wf-node-number">02</span>
            <span className="wf-node-title">
              {isLocal ? c.nodes.mapping : c.nodes.cloudMapping}
            </span>
            {isLocal ? (
              <span className="wf-node-tags">
                <code>[mio:prompt]</code>
                <code>[mio:negative]</code>
              </span>
            ) : (
              <span className="wf-node-detail">{c.nodes.cloudMappingDetail}</span>
            )}
          </button>
          <button {...nodeProps('engine', 2, c.topics[2].label)}>
            <span className="wf-node-number">03</span>
            <span className="wf-node-title">{isLocal ? c.nodes.engine : c.nodes.cloudEngine}</span>
            <span className="wf-node-detail">
              {isLocal ? c.nodes.engineDetail : c.nodes.cloudEngineDetail}
            </span>
          </button>
          <button {...nodeProps('model', 1, c.nodes.model)}>
            <span className="wf-node-number">A</span>
            <span className="wf-node-title">{c.nodes.model}</span>
            <span className="wf-node-detail">
              {isLocal ? c.nodes.modelDetail : c.nodes.localOnly}
            </span>
          </button>
          <button {...nodeProps('lora', 1, c.topics[1].label)}>
            <span className="wf-node-number">B</span>
            <span className="wf-node-title">{c.nodes.lora}</span>
            <span className="wf-node-detail wf-lora-value">
              {!isLocal
                ? c.nodes.localOnly
                : effectiveLora
                  ? `${c.nodes.weight} ${weight.toFixed(2)}`
                  : c.nodes.bypass}
            </span>
          </button>
          <button {...nodeProps('output', 2, c.nodes.output)}>
            <span className="wf-node-number">04</span>
            <span className="wf-node-title">{c.nodes.output}</span>
            <span className="wf-node-detail">{c.nodes.outputDetail}</span>
          </button>
        </div>

        <fieldset className="wf-lora-controls" disabled={!isLocal}>
          <legend>{c.loraControl}</legend>
          <label className="wf-checkbox">
            <input
              type="checkbox"
              checked={loraEnabled}
              onChange={(event) => {
                setLoraEnabled(event.target.checked);
                setTopic(1);
              }}
            />
            <span>{c.enable}</span>
          </label>
          <div className="wf-weight">
            <label htmlFor={`${id}-weight`}>{c.weightLabel}</label>
            <input
              id={`${id}-weight`}
              type="range"
              min="0"
              max="1.5"
              step="0.05"
              value={weight}
              disabled={!loraEnabled}
              onChange={(event) => {
                setWeight(Number(event.target.value));
                setTopic(1);
              }}
            />
            <output htmlFor={`${id}-weight`}>{weight.toFixed(2)}</output>
          </div>
        </fieldset>

        <div className="wf-route" role="status" aria-label={c.routeLabel}>
          <span className="wf-route-label">{c.routeLabel}</span>
          <p>{isLocal ? c.localRoute : c.cloudRoute}</p>
          <span className="wf-route-detail">
            {isLocal
              ? effectiveLora
                ? `${c.loraOn} · ${weight.toFixed(2)}`
                : c.loraOff
              : c.cloudLora}
          </span>
        </div>
        <p className="wf-demo-note">{c.demo}</p>
      </figure>

      <p className="wf-boundary">
        <span aria-hidden="true">*</span>
        {isLocal ? c.boundary : c.cloudBoundary}
      </p>
    </section>
  );
}
