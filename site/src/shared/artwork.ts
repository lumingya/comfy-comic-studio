import type { LocalizedText } from './types';

export function asset(name: string): string {
  return `${import.meta.env.BASE_URL}art/${name}`;
}

export type Artwork = {
  id: string;
  file: string;
  src: string;
  title: LocalizedText;
  caption: LocalizedText;
  alt: LocalizedText;
};

export const artworks: readonly Artwork[] = [
  {
    id: 'scene-01',
    file: 'scene-01.webp',
    src: asset('scene-01.webp'),
    title: { 'zh-CN': '认得每一扇门', en: 'Every door' },
    caption: {
      'zh-CN': '她记住了每一扇门，却还没有人叫过她的名字。',
      en: 'She knew every door. The town did not yet know her name.',
    },
    alt: {
      'zh-CN': '成年女邮差走在雨后小镇街道上的水彩插画',
      en: 'Watercolor of an adult postal worker walking through a town after the rain',
    },
  },
  {
    id: 'scene-02',
    file: 'scene-02.webp',
    src: asset('scene-02.webp'),
    title: { 'zh-CN': '没有门牌号', en: 'No street number' },
    caption: {
      'zh-CN': '长椅旁，一封没有门牌号的信，把她留住了。收件人只有五个字：给送信的人。',
      en: 'Beside a bench, an envelope stopped her. It had no street number—only “For the one who delivers.”',
    },
    alt: {
      'zh-CN': '女邮差在小镇长椅旁发现一封信的水彩插画',
      en: 'Watercolor of the postal worker finding a letter beside a town bench',
    },
  },
  {
    id: 'scene-03',
    file: 'scene-03.webp',
    src: asset('scene-03.webp'),
    title: { 'zh-CN': '下午三点', en: 'Three o’clock' },
    caption: {
      'zh-CN': '花店主人笑了：“下午三点来喝茶。我们等的，就是你。”',
      en: 'The florist smiled. “Come for tea at three. You’re the one we’ve been waiting for.”',
    },
    alt: {
      'zh-CN': '女邮差向年长花店主人递信的水彩插画',
      en: 'Watercolor of the postal worker handing a letter to an older florist',
    },
  },
  {
    id: 'scene-04',
    file: 'scene-04.webp',
    src: asset('scene-04.webp'),
    title: { 'zh-CN': '想回来的地方', en: 'Somewhere to return' },
    caption: {
      'zh-CN': '那天，她照常把信送到。也终于，有了想回来的一扇门。',
      en: 'That day, she delivered every letter. And found a door she wanted to return to.',
    },
    alt: {
      'zh-CN': '成年女邮差走在暖光小镇归途上的水彩插画',
      en: 'Watercolor of the adult postal worker on a warm-lit path through town',
    },
  },
];
