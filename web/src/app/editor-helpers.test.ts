import { describe, expect, it } from 'vitest';
import { captionText, replaceCaption } from '../pages/workshop/caption';
import { gallerySearch } from './navigation';
import { shortcutBlocked } from './shortcuts';

describe('editing and navigation boundaries', () => {
  it('edits the displayed speech instead of duplicating it as a narration, preserving metadata', () => {
    const lines = [
      { kind: 'speech' as const, text: 'old', speaker_id: 'a', bridge: true },
      { kind: 'thought' as const, text: 'keep', speaker_id: null, bridge: false },
    ];
    expect(captionText(lines)).toBe('old');
    expect(replaceCaption(lines, 'new')).toEqual([{ ...lines[0], text: 'new' }, lines[1]]);
    expect(replaceCaption(lines, '')).toEqual([lines[1]]);
  });
  it('edits only the first narration while keeping other lines', () => {
    const lines = [
      { kind: 'speech' as const, text: 'speech', speaker_id: null, bridge: false },
      { kind: 'narration' as const, text: 'caption', speaker_id: null, bridge: false },
      { kind: 'narration' as const, text: 'other', speaker_id: null, bridge: false },
    ];
    expect(replaceCaption(lines, 'changed')).toEqual([
      lines[0],
      { ...lines[1], text: 'changed' },
      lines[2],
    ]);
  });
  it('returns to the same collection filters without carrying reader-only parameters', () => {
    const search = gallerySearch(
      new URLSearchParams(
        'q=rain&sort=title&status=active&starred=1&ep=second&secret=not-retained',
      ),
    );
    expect(search).toBe('?q=rain&status=active&sort=title&starred=1');
  });
  it('keeps IME, text fields and nested dialog keys out of the underlying editor', () => {
    const scope = document.createElement('div');
    const field = document.createElement('input');
    scope.append(field);
    document.body.append(scope);
    const event = { target: field, defaultPrevented: false };
    try {
      expect(shortcutBlocked(event, scope)).toBe(true);
      expect(shortcutBlocked(event, scope, true)).toBe(false);
      expect(shortcutBlocked({ ...event, isComposing: true }, scope, true)).toBe(true);
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      scope.append(dialog);
      expect(shortcutBlocked(event, scope, true)).toBe(true);
      expect(shortcutBlocked({ target: dialog, defaultPrevented: false }, dialog)).toBe(false);
    } finally {
      scope.remove();
    }
  });
});
