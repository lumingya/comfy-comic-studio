import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { useUI } from '../../app/ui-store';
import i18n from '../../i18n';
import { AppearanceSection } from './AppearanceSection';

const preferences = useUI.getState();

afterEach(() => {
  useUI.setState(preferences);
  void i18n.changeLanguage('zh-CN');
  localStorage.removeItem('mio.locale');
  document.documentElement.lang = 'zh-CN';
});

it('keeps appearance and reading choices labelled, keyboard reachable and immediately saved', async () => {
  const user = userEvent.setup();
  render(<AppearanceSection />);
  const lettering = screen.getByRole('combobox', { name: '艺术字体风格' });
  await user.tab();
  expect(lettering).toHaveFocus();
  await user.selectOptions(lettering, 'calligraphy');
  await user.tab();
  const scale = screen.getByRole('combobox', { name: '界面字号' });
  expect(scale).toHaveFocus();
  await user.selectOptions(scale, 'xlarge');
  await user.tab();
  const density = screen.getByRole('combobox', { name: '界面密度' });
  expect(density).toHaveFocus();
  await user.selectOptions(density, 'compact');
  await user.selectOptions(screen.getByRole('combobox', { name: '默认阅读模式' }), 'spread');
  expect(useUI.getState()).toMatchObject({
    lettering: 'calligraphy',
    fontScale: 'xlarge',
    density: 'compact',
    defaultReaderMode: 'spread',
  });
  expect(JSON.parse(localStorage.getItem('mio.ui')!).state).toMatchObject({
    lettering: 'calligraphy',
    fontScale: 'xlarge',
    density: 'compact',
    defaultReaderMode: 'spread',
  });
});

it('retains the labelled language selector and updates its translated choices', async () => {
  render(<AppearanceSection />);
  const language = screen.getByRole('combobox', { name: '界面语言' });
  await userEvent.selectOptions(language, 'en');
  expect(localStorage.getItem('mio.locale')).toBe('en');
  expect(document.documentElement).toHaveAttribute('lang', 'en');
  expect(await screen.findByRole('combobox', { name: 'Display typeface' })).toBeInTheDocument();
});

it('defaults to pausing unfocused wallpaper and persists wallpaper power choices', async () => {
  render(<AppearanceSection />);
  const auto = screen.getByRole('switch', { name: '窗口失焦时自动暂停' });
  const still = screen.getByRole('switch', { name: '省电静帧模式' });
  expect(auto).toBeChecked();
  expect(still).not.toBeChecked();
  await userEvent.click(auto);
  await userEvent.click(still);
  expect(JSON.parse(localStorage.getItem('mio.ui')!).state).toMatchObject({
    pauseWallpaperWhenUnfocused: false,
    themeBackgroundPaused: true,
  });
});
