/**
 * The offline motion-comic player (server/mio_server/motion/player.js) driven in jsdom with fake
 * timers and a fake speech engine: shots advance after the voice and the minimum hold, subtitles
 * follow the lines, and the end card appears.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import player from '../../../server/mio_server/motion/player.js?raw';

interface FakeUtterance {
  text: string;
  pitch: number;
  rate: number;
  lang: string;
  onend: (() => void) | null;
}

const spoken: FakeUtterance[] = [];

function mount(shots: unknown[], config: Record<string, unknown>) {
  document.body.innerHTML =
    '<main id="stage"></main>' +
    `<script type="application/json" id="mio-motion">${JSON.stringify({
      series: '雨夜',
      title: '第一话',
      synopsis: '便利店',
      shots,
    })}</script>` +
    `<script type="application/json" id="mio-motion-config">${JSON.stringify(config)}</script>`;
  new Function(player)();
}

const line = (text: string, speaker = '林') => ({
  text,
  speaker,
  kind: 'speech',
  voice: { id: 'lin', gender: 'female', pitch: 1.2, rate: 1 },
});
const shot = (move: string, hold: number, lines: unknown[] = []) => ({
  image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  width: 1,
  height: 1,
  move,
  hold,
  lines,
});

const stage = () => document.getElementById('stage')!;
const playButton = () => stage().querySelector('.card button') as HTMLButtonElement;
const state = () => (window as unknown as { mioMotion: { state: { index: number } } }).mioMotion;

beforeEach(() => {
  vi.useFakeTimers();
  spoken.length = 0;
  const synth = {
    speak: (u: FakeUtterance) => {
      spoken.push(u);
      setTimeout(() => u.onend?.(), 1000); // each line takes 1 s to "say"
    },
    cancel: () => undefined,
    getVoices: () => [],
    onvoiceschanged: null,
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      pitch = 1;
      rate = 1;
      lang = '';
      onend: (() => void) | null = null;
      constructor(public text: string) {}
    },
  );
  (Element.prototype as unknown as { animate: unknown }).animate = vi.fn(() => ({
    cancel: vi.fn(),
    pause: vi.fn(),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('motion player', () => {
  it('shows a title card, then plays every shot with voice and ends', () => {
    mount([shot('push_in', 2, [line('走吧'), line('嗯', '周')]), shot('shake', 2)], {
      voice: true,
      subtitles: true,
      lang: 'zh-CN',
    });
    expect(stage().querySelector('.card h1')!.textContent).toBe('第一话');
    playButton().click();
    expect(state().state.index).toBe(0);
    expect(stage().querySelector('.subtitle')!.textContent).toBe('林走吧');
    expect(spoken[0].pitch).toBe(1.2);
    const animate = Element.prototype.animate as unknown as ReturnType<typeof vi.fn>;
    expect(animate.mock.calls[0][0]).toEqual([
      { transform: 'scale(1)' },
      { transform: 'scale(1.16)' },
    ]);

    vi.advanceTimersByTime(1300); // first line done (+250 ms pause)
    expect(stage().querySelector('.subtitle')!.textContent).toBe('周嗯');
    vi.advanceTimersByTime(1000);
    expect(state().state.index).toBe(0); // voice done but the hold is not over
    vi.advanceTimersByTime(1500);
    expect(state().state.index).toBe(1); // speech 2.5 s > hold 2 s, then 350 ms
    expect(animate.mock.calls[1][0][1].transform).toContain('translate(-1.6%,1%)');

    vi.advanceTimersByTime(2400);
    expect(stage().querySelector('.card h1')!.textContent).toBe('完');
    expect(stage().querySelector('.count')!.textContent).toBe('2 / 2');
  });

  it('without voice advances on the hold and keys control playback', () => {
    mount([shot('pan_left', 3, [line('雨停了', '')]), shot('still', 3)], {
      voice: false,
      subtitles: true,
    });
    playButton().click();
    expect(spoken).toHaveLength(0);
    vi.advanceTimersByTime(0);
    expect(stage().querySelector('.subtitle')!.textContent).toBe('雨停了');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); // pause
    vi.advanceTimersByTime(10_000);
    expect(state().state.index).toBe(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(state().state.index).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(state().state.index).toBe(0);
  });

  it('explains when nothing is playable', () => {
    mount([], { voice: true });
    expect(stage().querySelector('.card h1')!.textContent).toBe('没有可播放的画面');
    expect(stage().querySelector('.card button')).toBeNull();
  });
});
