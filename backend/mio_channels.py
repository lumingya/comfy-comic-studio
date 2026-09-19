"""Single channel-reference resolver for dispatch and safe UI configuration previews."""
import copy

class ChannelConfigurationError(ValueError):
    """Fix the shared saved configuration before dispatching more frames."""

BASE_FIELDS=('id','title','provider','baseUrl','model','keyMode','keyId','keyIds','extraParams')

def config_fields(provider=None):
    """Channel keys a snapshot may carry: shared keys plus the provider's declared form fields."""
    from backend.providers.registry import PROVIDERS
    if provider and PROVIDERS.has(provider):return tuple(dict.fromkeys(BASE_FIELDS+tuple(PROVIDERS.config_fields(provider))))
    keys=list(BASE_FIELDS)
    for spec in PROVIDERS.manifest():
        keys.extend(k for k in spec['configFields'] if k not in keys)
    return tuple(keys)

class _Fields(tuple):
    """Live view so legacy call sites reading CONFIG_FIELDS see extension providers."""
    def __iter__(self):return iter(config_fields())
    def __contains__(self,key):return key in config_fields()
    def __len__(self):return len(config_fields())

CONFIG_FIELDS=_Fields()

def workflow_provider(provider):
    from backend.providers.registry import PROVIDERS
    return PROVIDERS.has(provider) and PROVIDERS.spec(provider)['capabilities'].get('workflow') is True

def channel_reference(payload,frame):
    if frame.get('channelId'):return frame['channelId']
    # Existing browser jobs already stored the stable profile ID in their initial config.
    if payload.get('owner') and payload.get('albumId'):
        return frame.get('config',{}).get('id') or ('comfyui' if frame.get('config',{}).get('provider')=='comfyui' else None)
    return None

def resolve_channel(config,channel_id,provider):
    settings=config.get('uiConfig',{}).get('comfyStudio',{}).get('settings',{})
    profiles=settings.get('imageGeneration',{}).get('profiles',[])
    profile=next((p for p in profiles if p.get('id')==channel_id),None)
    if not profile:raise ChannelConfigurationError('渠道已删除或不存在：'+str(channel_id)+'。请恢复渠道；不会使用旧配置。')
    if profile.get('provider')!=provider:raise ChannelConfigurationError('渠道类型已改变，不能将已有任务静默切换到另一种协议引擎。')
    value={k:copy.deepcopy(profile[k]) for k in config_fields(provider) if k in profile}
    if workflow_provider(provider):
        value['baseUrl']=config.get('comfyConfig',{}).get('baseUrl','')
    else:
        if not isinstance(value.get('model'),str) or not value['model'].strip():raise ChannelConfigurationError('渠道模型为空，请保存有效模型后继续。')
        value.setdefault('keyMode','none')
    if not isinstance(value.get('baseUrl'),str) or not value['baseUrl'].strip():raise ChannelConfigurationError('渠道地址为空，请保存有效地址后继续。')
    return value

def channel_preview(config,ref):
    if not ref.get('id'):return {'id':None,'provider':ref['provider'],'model':ref.get('snapshotModel',''),'mode':'explicit','available':True}
    try:
        value=resolve_channel(config,ref['id'],ref['provider'])
        return {'id':ref['id'],'provider':value['provider'],'title':value.get('title',ref['id']),'model':value.get('model','工作流'),'mode':'live','available':True}
    except ValueError as exc:return {'id':ref['id'],'provider':ref['provider'],'model':'配置需处理','mode':'live','available':False,'error':str(exc)}
