import * as Dialog from '@radix-ui/react-dialog';
import { Check, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  useDeleteThemeWallpaper,
  useSaveThemePreferences,
  useThemePreferences,
  useThemeWallpapers,
  useUploadThemeWallpaper,
  type ThemeInfo,
  type ThemeSettingField,
  type ThemeWallpaper,
} from '../../api/open';
import { toastError } from '../../components/toast';
import {
  BRIDGE,
  type ThemeSettingsToFrame,
  type ThemeSettingsSaved,
  type ThemeSettingsFailed,
} from '../../api/extensionProtocol';
import './ThemeSettingsPanel.css';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSmallJson(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= BRIDGE.themeSettings.maxBytes
    );
  } catch {
    return false;
  }
}

function SettingField(props: {
  field: ThemeSettingField;
  value: unknown;
  wallpapers: ThemeWallpaper[];
  onChange: (value: unknown) => void;
  onCommit: () => void;
  onUpload: (file: File) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { field } = props;
  const labelId = `theme-setting-${field.id}`;
  if (field.type === 'file_upload') {
    return (
      <div className="theme-setting-field">
        <span className="theme-setting-label" id={labelId}>
          {field.label}
        </span>
        {field.description ? <small>{field.description}</small> : null}
        <label className="btn sm theme-upload-button" aria-labelledby={labelId}>
          <Upload size={14} />
          {props.busy
            ? t('settings.themes.uploadingWallpaper')
            : t('settings.themes.uploadWallpaper')}
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/webm,video/ogg"
            disabled={props.busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) props.onUpload(file);
            }}
          />
        </label>
        {props.wallpapers.length ? (
          <ul className="theme-wallpaper-list">
            {props.wallpapers.map((wallpaper) => (
              <li key={wallpaper.id}>
                <span className="grow" title={wallpaper.filename}>
                  {wallpaper.filename}
                </span>
                {props.value === wallpaper.id ? (
                  <Check size={14} aria-label={t('settings.themes.selectedWallpaper')} />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <small>{t('settings.themes.noWallpapers')}</small>
        )}
      </div>
    );
  }

  const wallpaperOptions =
    field.options_source === 'wallpapers'
      ? props.wallpapers.map((wallpaper) => ({ label: wallpaper.filename, value: wallpaper.id }))
      : (field.options ?? []);

  return (
    <label className="theme-setting-field" htmlFor={labelId}>
      <span className="theme-setting-label">{field.label}</span>
      {field.description ? <small>{field.description}</small> : null}
      {field.type === 'slider' ? (
        <span className="theme-setting-slider">
          <input
            id={labelId}
            type="range"
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            value={typeof props.value === 'number' ? props.value : Number(field.default ?? 0)}
            onChange={(event) => props.onChange(Number(event.currentTarget.value))}
            onPointerUp={props.onCommit}
            onBlur={props.onCommit}
          />
          <output>{String(props.value ?? field.default ?? '')}</output>
        </span>
      ) : null}
      {field.type === 'switch' ? (
        <input
          id={labelId}
          type="checkbox"
          checked={Boolean(props.value ?? field.default ?? false)}
          onChange={(event) => props.onChange(event.currentTarget.checked)}
        />
      ) : null}
      {field.type === 'select' ? (
        <select
          id={labelId}
          value={String(props.value ?? field.default ?? '')}
          onChange={(event) => {
            const selected = wallpaperOptions.find(
              (option) => String(option.value) === event.currentTarget.value,
            );
            props.onChange(selected?.value ?? event.currentTarget.value);
          }}
        >
          {field.options_source === 'wallpapers' ? (
            <option value="">{t('settings.themes.noWallpaper')}</option>
          ) : null}
          {wallpaperOptions.map((option, index) => (
            <option key={`${String(option.value)}-${index}`} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
    </label>
  );
}

function ThemeSettingsFrame(props: {
  theme: ThemeInfo;
  pageUrl: string;
  settings: Record<string, unknown>;
  save: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [session] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  );
  const settingsRef = useRef(props.settings);
  const saveRef = useRef(props.save);
  const updateRevision = useRef(0);
  settingsRef.current = props.settings;
  saveRef.current = props.save;

  useLayoutEffect(() => {
    let live = true;
    const currentFrame = frame.current;
    const post = (message: ThemeSettingsToFrame) => {
      if (live && frame.current === currentFrame)
        currentFrame?.contentWindow?.postMessage(message, '*');
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== 'null' ||
        event.source !== frame.current?.contentWindow ||
        !isRecord(event.data) ||
        event.data.session !== session
      )
        return;
      if (event.data.type !== BRIDGE.themeSettings.types.request) return;
      const requestId = event.data.requestId;
      if (typeof requestId !== 'string' || requestId.length > 80) return;
      const respond = (
        result: Pick<ThemeSettingsSaved, 'settings'> | Pick<ThemeSettingsFailed, 'error'>,
      ) =>
        post({
          type: BRIDGE.themeSettings.types.response,
          session,
          requestId,
          ...result,
        });
      if (event.data.action === BRIDGE.themeSettings.actions.getSettings) {
        respond({ settings: JSON.parse(JSON.stringify(settingsRef.current)) });
        return;
      }
      if (
        event.data.action !== BRIDGE.themeSettings.actions.updateSettings ||
        !isSmallJson(event.data.settings)
      ) {
        respond({ error: 'Invalid settings payload.' });
        return;
      }
      const revision = ++updateRevision.current;
      void saveRef.current(event.data.settings).then(
        (settings) => {
          if (live && revision === updateRevision.current) settingsRef.current = settings;
          respond({ settings: JSON.parse(JSON.stringify(settings)) });
        },
        () => respond({ error: 'Unable to save settings.' }),
      );
    };
    window.addEventListener('message', onMessage);
    return () => {
      live = false;
      window.removeEventListener('message', onMessage);
    };
  }, [session]);

  const pageUrl = new URL(props.pageUrl, window.location.href);
  pageUrl.hash = new URLSearchParams({ 'mio-theme-session': session }).toString();

  return (
    <iframe
      ref={frame}
      className="theme-settings-frame"
      title={props.theme.name}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src={pageUrl.href}
    />
  );
}

export function ThemeSettingsPanel({ theme, onClose }: { theme: ThemeInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const preferences = useThemePreferences(theme.id);
  const wallpapers = useThemeWallpapers(theme.id);
  const savePreferences = useSaveThemePreferences(theme.id);
  const uploadWallpaper = useUploadThemeWallpaper(theme.id);
  const deleteWallpaper = useDeleteThemeWallpaper(theme.id);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const draftRef = useRef(draft);
  const live = useRef(true);
  const sequence = useRef(0);
  const dirty = useRef(
    new Map<
      string,
      { value: unknown; sequence: number; promise?: Promise<Record<string, unknown>> }
    >(),
  );
  const frameDraft = useRef<{ value: Record<string, unknown>; sequence: number } | null>(null);
  const syncDraft = useCallback(() => {
    if (!live.current) return;
    const current = queryClient.getQueryData<Record<string, unknown>>([
      'theme-preferences',
      theme.id,
    ]);
    const next = { ...(frameDraft.current?.value ?? current ?? {}) };
    for (const [key, pending] of dirty.current) next[key] = pending.value;
    draftRef.current = next;
    setDraft(next);
  }, [queryClient, theme.id]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (preferences.data) syncDraft();
  }, [preferences.data, syncDraft]);

  const commit = (key: string) => {
    const pending = dirty.current.get(key);
    if (!pending) return Promise.resolve(draftRef.current);
    if (pending.promise) return pending.promise;
    const promise = savePreferences.mutateAsync({ path: [key], value: pending.value });
    pending.promise = promise;
    void promise
      .catch((error) => {
        if (live.current && dirty.current.get(key)?.sequence === pending.sequence)
          toastError(error);
      })
      .finally(() => {
        if (!live.current) return;
        if (dirty.current.get(key)?.sequence === pending.sequence) dirty.current.delete(key);
        syncDraft();
      });
    return promise;
  };
  const update = (key: string, value: unknown, saveImmediately = true) => {
    if (!live.current) return;
    dirty.current.set(key, { value, sequence: ++sequence.current });
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
    if (saveImmediately) void commit(key).catch(() => undefined);
  };

  const upload = async (file: File) => {
    try {
      const wallpaper = await uploadWallpaper.mutateAsync(file);
      if (live.current) update('wallpaper_id', wallpaper.id);
    } catch (error) {
      if (live.current) toastError(error);
    }
  };

  const remove = async (wallpaperId: string) => {
    try {
      await deleteWallpaper.mutateAsync(wallpaperId);
      if (live.current && draftRef.current.wallpaper_id === wallpaperId) update('wallpaper_id', '');
    } catch (error) {
      if (live.current) toastError(error);
    }
  };

  const saveFromFrame = async (next: Record<string, unknown>) => {
    const current = ++sequence.current;
    frameDraft.current = { value: next, sequence: current };
    draftRef.current = next;
    setDraft(next);
    try {
      return await savePreferences.mutateAsync({ path: [], value: next });
    } finally {
      if (live.current && frameDraft.current?.sequence === current) {
        frameDraft.current = null;
        syncDraft();
      }
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="theme-settings-overlay" />
        <Dialog.Content className="theme-settings-dialog">
          <header className="theme-settings-header">
            <div>
              <Dialog.Title>{t('settings.themes.moreSettings', { name: theme.name })}</Dialog.Title>
              <Dialog.Description>{t('settings.themes.privateSettingsHint')}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="btn ghost icon sm" aria-label={t('common.close')}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </header>
          {theme.settings_page_url ? (
            preferences.isPending ? (
              <div className="theme-settings-body">{t('common.loading')}</div>
            ) : preferences.isError ? (
              <div className="theme-settings-body">{t('common.error')}</div>
            ) : (
              <ThemeSettingsFrame
                theme={theme}
                pageUrl={theme.settings_page_url}
                settings={draft}
                save={saveFromFrame}
              />
            )
          ) : (
            <div className="theme-settings-body">
              {preferences.isLoading ? <p>{t('common.loading')}</p> : null}
              {(theme.settings_schema ?? []).map((field) => (
                <SettingField
                  key={field.id}
                  field={field}
                  value={draft[field.id] ?? field.default}
                  wallpapers={wallpapers.data?.items ?? []}
                  onChange={(value) => update(field.id, value, field.type !== 'slider')}
                  onCommit={() => void commit(field.id).catch(() => undefined)}
                  onUpload={(file) => void upload(file)}
                  busy={uploadWallpaper.isPending}
                />
              ))}
              {wallpapers.data?.items.length ? (
                <ul className="theme-wallpaper-manage-list">
                  {wallpapers.data.items.map((wallpaper) => (
                    <li key={wallpaper.id}>
                      <button
                        className="btn ghost sm"
                        aria-pressed={draft.wallpaper_id === wallpaper.id}
                        onClick={() => update('wallpaper_id', wallpaper.id)}
                      >
                        {draft.wallpaper_id === wallpaper.id ? <Check size={14} /> : null}
                        {wallpaper.filename}
                      </button>
                      <button
                        className="btn ghost icon sm danger"
                        aria-label={t('settings.themes.deleteWallpaper', {
                          name: wallpaper.filename,
                        })}
                        disabled={deleteWallpaper.isPending}
                        onClick={() => void remove(wallpaper.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!theme.settings_schema?.length ? (
                <p className="small muted">{t('settings.themes.noSettings')}</p>
              ) : null}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
