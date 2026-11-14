import type { AssembleVars } from '../../api/workshop';

/** Keep one key for retries of an unchanged request, independently for each canvas node. */
export class AssemblyIntents {
  private entries = new Map<string, { fingerprint: string; key: string }>();

  keyFor(id: string, body: AssembleVars) {
    const fingerprint = JSON.stringify(body);
    const previous = this.entries.get(id);
    if (previous?.fingerprint === fingerprint) return previous.key;
    const key =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
    this.entries.set(id, { fingerprint, key });
    return key;
  }

  retain(ids: string[]) {
    for (const id of this.entries.keys()) {
      if (!ids.includes(id)) this.entries.delete(id);
    }
  }

  clear(id: string) {
    this.entries.delete(id);
  }
}
