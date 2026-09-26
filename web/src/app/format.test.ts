import { describe, expect, it } from 'vitest';
import { relativeTime, shortDateTime } from './format';

const now = Date.parse('2026-09-26T12:00:00Z');
const ago = (s: number) => new Date(now - s * 1000).toISOString();

describe('relativeTime', () => {
  it('reads naturally in both locales', () => {
    expect(relativeTime(ago(5), 'en', now)).toBe('now');
    expect(relativeTime(ago(180), 'en', now)).toBe('3 minutes ago');
    expect(relativeTime(ago(2 * 3600), 'zh-CN', now)).toBe('2小时前');
    expect(relativeTime(ago(86400), 'zh-CN', now)).toBe('昨天');
  });

  it('falls back to the date, and tolerates bad input', () => {
    expect(relativeTime(ago(30 * 86400), 'en', now)).toMatch(/2026/);
    expect(relativeTime('', 'en', now)).toBe('');
    expect(relativeTime('not a date', 'en', now)).toBe('');
  });
});

describe('shortDateTime', () => {
  it('formats a unix timestamp in the UI locale', () => {
    const seconds = Date.parse('2026-09-26T14:05:00Z') / 1000;
    expect(shortDateTime(seconds, 'en')).toMatch(/9\/26/);
    expect(shortDateTime(seconds, 'zh-CN')).toMatch(/9\/26|9月26日/);
  });
});
