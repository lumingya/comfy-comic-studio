import type { AlbumTemplateInfo } from '../../api/open';
import type { ExportDraft } from './presentation';
import type { NativeLayout } from './readingStage';

export type Format = 'html' | 'pdf' | 'zip' | 'slices' | 'long' | 'source' | 'kit';
export const FORMATS: Format[] = ['html', 'pdf', 'zip', 'slices', 'long', 'source', 'kit'];

export interface PresentationDrawerProps {
  open: boolean;
  onClose: () => void;
  templates: {
    id: string;
    title: string;
    description: string;
    accent?: string;
    layout?: string;
    layoutName?: string;
  }[];
  infos: AlbumTemplateInfo[];
  look: string;
  native: string;
  onLook: (id: string) => void;
  draft: ExportDraft;
  onDraft: (patch: Partial<ExportDraft>) => void;
  layout: NativeLayout;
  onLayout: (layout: NativeLayout) => void;
  seriesId: string | undefined;
  episodes: { id?: string; title: string }[];
  episodeId: string | undefined;
  title: string;
  lettered: boolean;
  onPlatform: (open: boolean) => void;
}
