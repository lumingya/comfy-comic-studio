import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { raw, notifyHost } from './runtime';

export interface AssistChannel {
  id: string;
  name: string;
  provider: 'openai' | 'deepseek' | 'gemini';
  base_url: string;
  api_key: string;
  model: string;
  timeout?: number;
}
export interface AssistSettings {
  mode: 'floating' | 'page';
  active_channel_id: string;
  channels: AssistChannel[];
  permissions: {
    scopes: string[];
    allow_operations: string[];
    deny_operations: string[];
    confirm_mutations: boolean;
  };
  storage_path?: string;
}
export interface AssistTool {
  id: string;
  method: string;
  path: string;
  summary: string;
  scope: string;
  allowed: boolean;
  configurable?: boolean;
  reason?: string;
}
export interface AssistAttachment {
  id: string;
  name: string;
  mime_type: string;
  url: string;
}
export interface AssistCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  summary?: string;
  scope?: string;
  status?: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'rejected' | 'unknown';
  result?: unknown;
}
export interface AssistMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  attachment_ids?: string[];
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
}
export interface AssistConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: AssistMessage[];
  run: {
    id: string;
    status:
      'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'stopped' | 'interrupted';
    error?: string;
    pending_calls?: AssistCall[];
    request_key?: string;
  };
}
export interface AssistSendPayload {
  content: string;
  attachment_ids: string[];
}
export interface AssistRequestReceipt {
  found: boolean;
  status: string;
  conversation: AssistConversation | null;
}
const base = '/api/ext/ai-assist';
export const assistKey = ['ai-assist'] as const;
async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await raw(`${base}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
  return response.status === 204 ? (undefined as T) : response.json();
}
export const isAssistRunning = (c?: AssistConversation) =>
  !!c && ['running', 'waiting_approval'].includes(c.run.status);

export function useAssistStatus() {
  return useQuery({
    queryKey: [...assistKey, 'status'],
    queryFn: () => json<{ enabled: boolean; mode: AssistSettings['mode'] }>('/status'),
    retry: false,
  });
}
export function useAssistSettings(enabled = true) {
  return useQuery({
    queryKey: [...assistKey, 'settings'],
    queryFn: () => json<AssistSettings>('/settings'),
    enabled,
  });
}
export function useAssistTools(enabled = true) {
  return useQuery({
    queryKey: [...assistKey, 'tools'],
    queryFn: () => json<{ items: AssistTool[] }>('/tools'),
    enabled,
  });
}
export function useAssistConversations(enabled = true) {
  return useQuery({
    queryKey: [...assistKey, 'conversations'],
    queryFn: () => json<{ items: AssistConversation[] }>('/conversations'),
    enabled,
  });
}
export function useAssistConversation(id: string | null, enabled = true) {
  return useQuery({
    queryKey: [...assistKey, 'conversation', id],
    enabled: !!id && enabled,
    queryFn: () => json<AssistConversation>(`/conversations/${encodeURIComponent(id!)}`),
    refetchInterval: (query) => (isAssistRunning(query.state.data) ? 800 : false),
  });
}
export function useAssistAction<T = AssistConversation>() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      method = 'POST',
      body,
    }: {
      path: string;
      method?: string;
      body?: unknown;
    }) => json<T>(path, method, body),
    onSuccess: () => {
      notifyHost('changed');
      return qc.invalidateQueries({ queryKey: assistKey });
    },
    retry: false,
  });
}
export function useAssistRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) =>
      json<AssistRequestReceipt>(
        `/conversations/${encodeURIComponent(id)}/requests/${encodeURIComponent(key)}`,
      ),
    onSuccess: (receipt, { id }) => {
      if (receipt.found && receipt.conversation?.id === id)
        qc.setQueryData([...assistKey, 'conversation', id], receipt.conversation);
    },
    retry: false,
  });
}
export async function discoverAssistModels(channel: AssistChannel) {
  return json<{ items: { id: string; name?: string }[] }>('/models', 'POST', channel);
}
export async function uploadAssistAttachment(file: File): Promise<AssistAttachment> {
  const body = new FormData();
  body.append('file', file);
  return (await raw(`${base}/attachments`, { method: 'POST', body })).json();
}
export const assistAttachmentUrl = (id: string) => `${base}/attachments/${encodeURIComponent(id)}`;
