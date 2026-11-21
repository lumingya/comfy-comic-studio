import * as Tabs from '@radix-ui/react-tabs';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAssemblyPreview,
  type AssembleVars,
  type AssemblyPreview,
  type AssemblyVariable,
} from '../../api/workshop';
import { Icon } from '../../app/icons';
import './assembly-review.css';

type Scene = AssemblyPreview['panels'][number];
type VariableLocation = { scene: Scene; index: number; variable: AssemblyVariable };

const needsReview = ({ status }: AssemblyVariable) => status !== 'resolved' && status !== 'empty';

function indexScenes(report: AssemblyPreview | undefined) {
  return (report?.panels ?? []).map((scene) => ({
    scene,
    problems: scene.variables.flatMap((variable, index): VariableLocation[] =>
      needsReview(variable) ? [{ scene, index, variable }] : [],
    ),
  }));
}

function locateVariable(scene: Scene | undefined, location: VariableLocation | undefined) {
  if (!scene || !location || scene.panel_id !== location.scene.panel_id) return -1;
  const matches = (item: AssemblyVariable | undefined) =>
    item?.key === location.variable.key && item.field === location.variable.field;
  return matches(scene.variables[location.index])
    ? location.index
    : scene.variables.findIndex(matches);
}

export function AssemblyReview({
  body,
  variables,
  onVariables,
  kitId,
}: {
  body: AssembleVars;
  variables: Record<string, string>;
  onVariables: (next: Record<string, string>) => void;
  kitId?: string;
}) {
  const { t } = useTranslation();
  const preview = useAssemblyPreview(body, true, kitId);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [location, setLocation] = useState<VariableLocation>();
  const [snapshot, setSnapshot] = useState<{ kitId?: string; report: AssemblyPreview }>();
  const details = useRef<HTMLDivElement>(null);
  const tabList = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLLIElement>(null);
  const loading = preview.isFetching || preview.isPending;
  const report = !loading && !preview.isError ? preview.data : undefined;
  if (report && (snapshot?.report !== report || snapshot?.kitId !== kitId)) {
    setSnapshot({ kitId, report });
  }
  // Preserve the active editor during refetch, while hiding all earlier findings and prompts.
  const layout =
    report ??
    (snapshot?.kitId === kitId && snapshot?.report.storyboard_id === body.storyboard_id
      ? snapshot.report
      : undefined);
  const scenes = useMemo(() => indexScenes(layout), [layout]);
  const problems = useMemo(() => scenes.flatMap((item) => item.problems), [scenes]);
  const visible = onlyProblems
    ? scenes.filter(
        ({ scene, problems }) => problems.length || (editing && scene.panel_id === selectedId),
      )
    : scenes;
  const preferred = visible.findIndex(({ scene }) => scene.panel_id === selectedId);
  const firstProblem = visible.findIndex((item) => item.problems.length > 0);
  const index = preferred >= 0 ? preferred : Math.max(0, firstProblem);
  const current = visible[index];
  const scene = current?.scene;
  const keys = [
    ...new Set(
      scene?.variables
        .filter((v) => needsReview(v) || Object.hasOwn(variables, v.key))
        .map((v) => v.key),
    ),
  ];
  const highlightedIndex = locateVariable(scene, location);

  useLayoutEffect(() => {
    if (details.current) details.current.scrollTop = 0;
    const list = tabList.current;
    const tab = list?.querySelector('[aria-selected="true"]');
    if (!list || !tab) return;
    const track = list.getBoundingClientRect();
    const chip = tab.getBoundingClientRect();
    if (chip.left < track.left) list.scrollLeft += chip.left - track.left - 4;
    else if (chip.right > track.right) list.scrollLeft += chip.right - track.right + 4;
  }, [scene?.panel_id]);

  useLayoutEffect(() => {
    const scroll = details.current;
    const row = target.current;
    if (!scroll || !row) return;
    row.focus({ preventScroll: true });
    scroll.scrollTop += row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8;
  }, [location]);

  const selectScene = (panelId: string) => {
    setSelectedId(panelId);
    setLocation(undefined);
  };
  const locate = (item: VariableLocation) => {
    setSelectedId(item.scene.panel_id);
    setLocation({ ...item });
  };
  const fieldName = (field: string) =>
    field.startsWith('dialogues.')
      ? t('ws.assemble.review.dialogue', { n: Number(field.split('.')[1]) + 1 })
      : t(`ws.assemble.review.fields.${field.split('.').at(-1)}`);
  const sourceName = (variable: AssemblyVariable) =>
    [t(`ws.assemble.review.sources.${variable.source}`), variable.source_title]
      .filter(Boolean)
      .join(' · ');
  const describe = ({ scene, variable }: VariableLocation) =>
    [
      t('ws.assemble.review.scene', { n: scene.order + 1 }),
      fieldName(variable.field),
      `{${variable.key}}`,
      t(`ws.assemble.review.status.${variable.status}`),
    ].join(' · ');

  return (
    <section className="designer-card assembly-review" aria-label={t('ws.assemble.review.title')}>
      <header className="designer-card-head">
        <h4>{t('ws.assemble.review.title')}</h4>
      </header>
      <div className="assembly-review-summary">
        {preview.isError ? (
          <div role="alert">
            <p>{t('ws.assemble.review.failed', { message: preview.error.message })}</p>
            <button type="button" className="btn" onClick={() => void preview.refetch()}>
              {t('ws.assemble.review.retry')}
            </button>
          </div>
        ) : (
          <p role="status">
            {report
              ? problems.length
                ? t('ws.assemble.review.summary', { scenes: scenes.length, count: problems.length })
                : t('ws.assemble.review.checked', { count: scenes.length })
              : t('ws.assemble.review.loading')}
          </p>
        )}
        {layout && (problems.length || onlyProblems) ? (
          <label>
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(event) => {
                setOnlyProblems(event.target.checked);
                setLocation(undefined);
              }}
            />
            {t('ws.assemble.review.onlyProblems')}
          </label>
        ) : null}
      </div>
      {scene ? (
        <Tabs.Root
          value={scene.panel_id}
          onValueChange={selectScene}
          className="assembly-review-scenes"
        >
          <div className="assembly-review-navigation">
            <Tabs.List ref={tabList} aria-label={t('ws.assemble.review.scenes')}>
              {visible.map(({ scene, problems }) => (
                <Tabs.Trigger key={scene.panel_id} value={scene.panel_id}>
                  {String(scene.order + 1).padStart(2, '0')}
                  <span className="assembly-review-scene-title" title={scene.title}>
                    {scene.title}
                  </span>
                  {report && problems.length ? (
                    <>
                      <span className="assembly-review-count" aria-hidden="true">
                        {problems.length}
                      </span>
                      <span className="sr-only">
                        {t('ws.assemble.review.problemCount', { count: problems.length })}
                      </span>
                    </>
                  ) : null}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <div className="assembly-review-arrows">
              <button
                type="button"
                className="ibtn"
                disabled={index === 0}
                aria-label={t('ws.assemble.review.prevScene')}
                title={t('ws.assemble.review.prevScene')}
                onClick={() => selectScene(visible[index - 1].scene.panel_id)}
              >
                <Icon name="arrow" className="is-back" sm />
              </button>
              <button
                type="button"
                className="ibtn"
                disabled={index + 1 >= visible.length}
                aria-label={t('ws.assemble.review.nextScene')}
                title={t('ws.assemble.review.nextScene')}
                onClick={() => selectScene(visible[index + 1].scene.panel_id)}
              >
                <Icon name="arrow" sm />
              </button>
            </div>
          </div>
          <Tabs.Content ref={details} className="assembly-review-detail" value={scene.panel_id}>
            {report && problems.length > (current?.problems.length ?? 0) ? (
              <select
                className="assembly-review-jump"
                aria-label={t('ws.assemble.review.jumpToProblem')}
                value=""
                onChange={(event) => {
                  const item = problems[Number(event.target.value)];
                  if (item && event.target.value) locate(item);
                }}
              >
                <option value="">{t('ws.assemble.review.jumpToProblem')}</option>
                {problems.map((item, i) => (
                  <option key={i} value={i}>
                    {describe(item)}
                  </option>
                ))}
              </select>
            ) : null}
            {report && current?.problems.length ? (
              <ul className="assembly-review-problems">
                {current.problems.map((item) => (
                  <li key={item.index}>
                    <button type="button" className="btn ghost" onClick={() => locate(item)}>
                      {describe(item)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {keys.length ? (
              <fieldset
                className="assembly-review-variables"
                onFocus={() => {
                  setEditing(true);
                  setSelectedId(scene.panel_id);
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false);
                }}
              >
                <legend>{t('ws.assemble.review.temporary')}</legend>
                <p className="help">{t('ws.assemble.review.temporaryHelp')}</p>
                {keys.map((key) => (
                  <div key={key} className="assembly-review-input">
                    <label>
                      <span>{`{${key}}`}</span>
                      <input
                        aria-label={t('ws.assemble.review.variable', { name: key })}
                        value={variables[key] ?? ''}
                        placeholder={t('ws.assemble.review.variableHint')}
                        onChange={(e) => onVariables({ ...variables, [key]: e.target.value })}
                      />
                    </label>
                    {Object.hasOwn(variables, key) ? (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          onVariables(
                            Object.fromEntries(
                              Object.entries(variables).filter(([k]) => k !== key),
                            ),
                          )
                        }
                      >
                        {t('ws.assemble.review.remove')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => onVariables({ ...variables, [key]: '' })}
                      >
                        {t('ws.assemble.review.useEmpty')}
                      </button>
                    )}
                  </div>
                ))}
              </fieldset>
            ) : null}
            {report ? (
              <article aria-label={t('ws.assemble.review.scene', { n: scene.order + 1 })}>
                <h5>{scene.title}</h5>
                <dl className="assembly-review-text">
                  <dt>{t('ws.assemble.review.positive')}</dt>
                  <dd>{scene.positive || t('ws.assemble.review.empty')}</dd>
                  <dt>{t('ws.assemble.review.negative')}</dt>
                  <dd>{scene.negative || t('ws.assemble.review.empty')}</dd>
                  {scene.dialogues.map((line, i) => (
                    <div key={i}>
                      <dt>{t('ws.assemble.review.dialogue', { n: i + 1 })}</dt>
                      <dd>{line || t('ws.assemble.review.empty')}</dd>
                    </div>
                  ))}
                </dl>
                {scene.variables.length ? (
                  <ul className="assembly-review-values">
                    {scene.variables.map((variable, i) => {
                      const highlighted = highlightedIndex === i;
                      return (
                        <li
                          key={`${variable.field}-${variable.key}-${i}`}
                          tabIndex={-1}
                          ref={highlighted ? target : undefined}
                          data-highlighted={highlighted || undefined}
                          data-problem={needsReview(variable) || undefined}
                          aria-label={`${fieldName(variable.field)} · {${variable.key}}`}
                        >
                          <code>{`{${variable.key}}`}</code>
                          <span>
                            {fieldName(variable.field)} · {sourceName(variable)} ·{' '}
                            {t(`ws.assemble.review.status.${variable.status}`)}
                          </span>
                          <q>{variable.value ?? t('ws.assemble.review.unresolved')}</q>
                          {variable.chain.length > 1 ? (
                            <small>{variable.chain.join(' → ')}</small>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </article>
            ) : null}
          </Tabs.Content>
        </Tabs.Root>
      ) : onlyProblems && report ? (
        <p className="assembly-review-detail assembly-review-no-problems">
          {t('ws.assemble.review.noProblemScenes')}
        </p>
      ) : null}
    </section>
  );
}
