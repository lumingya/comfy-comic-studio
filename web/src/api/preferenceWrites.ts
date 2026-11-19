import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, raw } from './client';

export type Preferences = Record<string, unknown>;
export type PreferenceIntent = { path: string[]; value: unknown };
type Snapshot = { value: Preferences; revision?: string };
type PendingIntent = PreferenceIntent & { sequence: number; remote: number };
type Resource = {
  confirmed?: Snapshot;
  sequence: number;
  epoch: number;
  read: number;
  remote: number;
  pending: Map<number, PendingIntent>;
  tail: Promise<unknown>;
};

const resources = new WeakMap<QueryClient, Map<string, Resource>>();
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

function isObject(value: unknown): value is Preferences {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resourceFor(client: QueryClient, path: string): Resource {
  let entries = resources.get(client);
  if (!entries) resources.set(client, (entries = new Map()));
  let resource = entries.get(path);
  if (!resource) {
    resource = {
      sequence: 0,
      epoch: 0,
      read: 0,
      remote: 0,
      pending: new Map(),
      tail: Promise.resolve(),
    };
    entries.set(path, resource);
  }
  return resource;
}

function applyIntent(current: Preferences, intent: PreferenceIntent): Preferences {
  if (!intent.path.length) {
    if (!isObject(intent.value)) throw new Error('Preferences require a JSON object.');
    return intent.value;
  }
  const update = (object: Preferences, depth: number): Preferences => {
    const key = intent.path[depth];
    if (depth === intent.path.length - 1) return { ...object, [key]: intent.value };
    const next = Object.hasOwn(object, key) ? object[key] : {};
    if (!isObject(next)) throw new Error('Preference path crosses a non-object value.');
    return { ...object, [key]: update(next, depth + 1) };
  };
  return update(current, 0);
}

function projected(resource: Resource): Preferences {
  let value = resource.confirmed?.value ?? {};
  for (const intent of resource.pending.values()) {
    try {
      value = applyIntent(value, intent);
    } catch {
      // A conflicting remote shape must not hide unrelated queued edits. The server will
      // reject this exact intent; the finally path then publishes the authoritative value.
    }
  }
  return value;
}

async function snapshot(path: string, init?: RequestInit): Promise<Snapshot> {
  const response = await raw(path, init);
  const value: unknown = await response.json();
  if (!isObject(value)) throw new Error('Invalid preference response.');
  const revision = /^"([a-f0-9]{64})"$/.exec(response.headers.get('ETag') ?? '')?.[1];
  return { value, revision };
}

/** Both resources use this queue, including separate components editing sibling subtrees. */
export function usePrivatePreferences(path: string | null, queryKey: readonly unknown[]) {
  const client = useQueryClient();
  return useQuery({
    queryKey,
    enabled: path !== null,
    queryFn: async ({ signal }) => {
      const resource = resourceFor(client, path!);
      const epoch = resource.epoch;
      const read = ++resource.read;
      const result = await snapshot(path!, { signal });
      signal.throwIfAborted();
      if (resource.epoch === epoch && resource.read === read) {
        if (resource.confirmed?.revision && resource.confirmed.revision !== result.revision)
          resource.remote += 1;
        resource.confirmed = result;
        resource.epoch += 1;
      }
      return projected(resource);
    },
  });
}

function write(
  client: QueryClient,
  path: string,
  queryKey: readonly unknown[],
  input: PreferenceIntent,
): Promise<Preferences> {
  if (
    !Array.isArray(input.path) ||
    input.path.length > 16 ||
    input.path.some((key) => typeof key !== 'string' || !key || forbiddenKeys.has(key))
  )
    return Promise.reject(new Error('Invalid preference path.'));
  // Freeze queued input so later draft changes cannot change an already submitted intent.
  let frozen: PreferenceIntent;
  try {
    frozen = JSON.parse(JSON.stringify(input)) as PreferenceIntent;
    if (!Object.hasOwn(frozen, 'value')) throw new Error('Missing preference value.');
  } catch (error) {
    return Promise.reject(error);
  }
  const resource = resourceFor(client, path);
  if (!resource.confirmed) {
    const cached = client.getQueryData<Preferences>(queryKey);
    if (cached) resource.confirmed = { value: cached };
  }
  const intent = { ...frozen, sequence: ++resource.sequence, remote: resource.remote };
  resource.pending.set(intent.sequence, intent);
  const publish = () => client.setQueryData(queryKey, projected(resource));
  const optimistic = client.cancelQueries({ queryKey }).then(publish);
  const refresh = async () => {
    const result = await snapshot(path);
    if (resource.confirmed?.revision && resource.confirmed.revision !== result.revision)
      resource.remote += 1;
    resource.confirmed = result;
    resource.epoch += 1;
    return result;
  };
  const operation = resource.tail
    .catch(() => undefined)
    .then(async () => {
      await optimistic;
      let reconciled = false;
      try {
        if (!resource.confirmed?.revision) await refresh();
        if (!intent.path.length && intent.remote !== resource.remote)
          throw new ApiError('Preferences changed remotely. Reload before replacing them.', 409);
        for (let attempt = 0; ; attempt += 1) {
          const revision = resource.confirmed?.revision;
          if (!revision) throw new Error('The server did not provide a preference revision.');
          try {
            reconciled = false;
            const epoch = resource.epoch;
            const result = await snapshot(path, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                expected_revision: revision,
                path: intent.path,
                value: intent.value,
              }),
            });
            if (!result.revision)
              throw new Error('The server did not provide a preference revision.');
            if (resource.epoch !== epoch && resource.confirmed?.revision !== result.revision)
              return (await refresh()).value;
            resource.confirmed = result;
            resource.epoch += 1;
            return result.value;
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 409) throw error;
            await refresh();
            reconciled = true;
            // Only an explicit subtree can be safely replayed over a remote writer's changes.
            if (!intent.path.length || attempt >= 1) throw error;
          }
        }
      } catch (error) {
        // A failed response need not mean the write did not happen. Read before rolling back.
        try {
          if (!reconciled) await refresh();
        } catch {
          void client.invalidateQueries({ queryKey });
        }
        throw error;
      } finally {
        resource.pending.delete(intent.sequence);
        publish();
      }
    });
  resource.tail = operation;
  return operation;
}

export function useWritePrivatePreferences(path: string, queryKey: readonly unknown[]) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (intent: PreferenceIntent) => write(client, path, queryKey, intent),
  });
}
