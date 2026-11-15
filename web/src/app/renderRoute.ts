import { useTranslation } from 'react-i18next';
import { useProfiles, useSettings } from '../api/system';
import type { AppSettings, RenderProfile } from '../api/types';
import { useComfyHealth, type ComfyState } from './comfy';

export function resolveProfile(
  profiles: readonly RenderProfile[],
  override?: string | null,
  fallback?: string | null,
) {
  const id = override || fallback || 'profile_default';
  return { id, profile: profiles.find((profile) => profile.id === id) };
}

export function resolveCloud(profile: RenderProfile, settings: AppSettings) {
  const id = profile.cloud_channel || settings.image_channel || '';
  const channel = settings.image_channels?.find((value) => value.id === id);
  // The chat-image fallback is available without a named channel. Saved configuration
  // does not establish that credentials or a live service are working.
  const configured = id
    ? !!channel &&
      (channel.kind !== 'chat_image' || !!(channel.base_url || settings.llm.base_url).trim())
    : !!settings.llm.base_url.trim();
  return { id, channel, configured };
}

export type RouteState = ComfyState | 'configured' | 'missing' | 'unchecked';

/** Shared by setup, assembly and the panel editor. Never sends a paid request. */
export function useRenderRoute(
  override?: string | null,
  fallback?: string | null,
  waiting = false,
  probeLocal = true,
  taskProfile?: RenderProfile | null,
) {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const settings = useSettings();
  const selected = resolveProfile(profiles.data ?? [], override, fallback);
  const profile = taskProfile ?? selected.profile;
  const id = profile?.id ?? selected.id;
  const kind = !profile
    ? null
    : !profile.cloud_shape
      ? 'local'
      : profile.cloud_refine
        ? 'hybrid'
        : 'cloud';
  const needsLocal = kind === 'local' || kind === 'hybrid';
  const comfy = useComfyHealth(profile?.instances, !waiting && needsLocal && probeLocal);
  const cloud = profile && settings.data ? resolveCloud(profile, settings.data) : null;
  const loading =
    waiting || (!taskProfile && profiles.isPending) || (kind !== 'local' && settings.isPending);
  const state: RouteState = loading
    ? 'checking'
    : !profile || (!taskProfile && profiles.isError)
      ? 'missing'
      : kind !== 'local' && !cloud?.configured
        ? 'missing'
        : needsLocal
          ? !probeLocal
            ? 'unchecked'
            : kind === 'hybrid' && comfy.state === 'online'
              ? 'configured'
              : comfy.state
          : 'configured';
  const channel = cloud?.channel?.label || cloud?.id || t('route.chatFallback');
  const label = kind ? t(`route.${kind}`) : t('route.chooseProfile');
  const summary = kind === 'cloud' || kind === 'hybrid' ? `${label} · ${channel}` : label;
  const to =
    !profile || (!taskProfile && profiles.isError)
      ? '/engine?tab=profiles'
      : kind !== 'local' && !cloud?.configured
        ? cloud?.id
          ? '/engine?tab=channels'
          : '/settings?tab=general'
        : needsLocal
          ? '/engine?tab=instances'
          : cloud?.id
            ? '/engine?tab=channels'
            : '/settings?tab=general';
  const detail = loading
    ? t('route.checking')
    : !profile || (!taskProfile && profiles.isError)
      ? t('route.missingProfile', { id })
      : kind !== 'local' && !cloud?.configured
        ? t('route.missingChannel', { id: cloud?.id || t('route.chatFallback') })
        : state === 'unchecked'
          ? t('route.localUnchecked')
          : state === 'unset' || state === 'offline'
            ? t(state === 'unset' ? 'route.noInstances' : 'route.offline')
            : state === 'checking'
              ? t('route.checking')
              : kind === 'cloud' || kind === 'hybrid'
                ? `${t('route.configuredHint', { name: channel })}${kind === 'hybrid' ? ` ${t('route.localHint', { name: comfy.name })}` : ''}`
                : t('route.localHint', { name: comfy.name });
  return { id, profile, kind, needsLocal, state, label, summary, detail, to, comfy };
}
