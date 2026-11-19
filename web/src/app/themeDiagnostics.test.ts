import { afterEach, expect, it } from 'vitest';
import {
  MAX_THEME_DIAGNOSTICS,
  readThemeDiagnostics,
  themeDiagnosticSession,
} from './themeDiagnostics';

afterEach(() => {
  sessionStorage.removeItem('mio.diagnostics');
  readThemeDiagnostics();
});

it('collects nothing unless diagnostics are explicitly enabled and clears history when disabled', () => {
  const report = themeDiagnosticSession('script', 'my-theme', 'a'.repeat(64));
  report('digest-mismatch');
  expect(window.mioThemeDiagnostics).toEqual([]);
  sessionStorage.setItem('mio.diagnostics', '1');
  report('script-error');
  expect(readThemeDiagnostics()).toEqual([]);
  sessionStorage.setItem('mio.diagnostics', 'true');
  report('script-error');
  expect(readThemeDiagnostics()).toHaveLength(1);
  sessionStorage.removeItem('mio.diagnostics');
  expect(window.mioThemeDiagnostics).toEqual([]);
  sessionStorage.setItem('mio.diagnostics', 'true');
  expect(window.mioThemeDiagnostics).toEqual([]);
});

it('exposes frozen bounded snapshots and separates identities and runtime sessions', () => {
  sessionStorage.setItem('mio.diagnostics', 'true');
  const first = themeDiagnosticSession('script', 'my-theme', 'a'.repeat(64));
  const second = themeDiagnosticSession('script', 'my-theme', 'b'.repeat(64));
  first('script-started');
  second('digest-mismatch');
  const snapshot = window.mioThemeDiagnostics;
  expect(snapshot[0].session).not.toBe(snapshot[1].session);
  expect(snapshot.map((entry) => entry.digest)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  expect(Object.getOwnPropertyDescriptor(window, 'mioThemeDiagnostics')?.set).toBeUndefined();
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Reflect.set(snapshot[0], 'message', 'changed')).toBe(false);
  expect(Reflect.set(snapshot, '0', {})).toBe(false);
  for (let index = 0; index < MAX_THEME_DIAGNOSTICS + 1; index += 1) second('script-timeout');
  expect(readThemeDiagnostics()).toHaveLength(MAX_THEME_DIAGNOSTICS);
  expect(snapshot).toHaveLength(2);
});

it('only records validated identifiers and fixed messages, not arbitrary theme metadata', () => {
  sessionStorage.setItem('mio.diagnostics', 'true');
  themeDiagnosticSession('script', 'secret\nvalue', 'not-a-digest')('script-fetch-failed');
  const diagnostic = readThemeDiagnostics()[0];
  expect(diagnostic.theme_id).toBe('[invalid]');
  expect(diagnostic.digest).toBeNull();
  expect(JSON.stringify(diagnostic)).not.toContain('secret');
  expect(Object.keys(diagnostic).sort()).toEqual([
    'at',
    'code',
    'component',
    'digest',
    'message',
    'session',
    'theme_id',
  ]);
});
