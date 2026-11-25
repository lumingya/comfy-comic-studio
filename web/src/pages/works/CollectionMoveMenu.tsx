import * as Menu from '@radix-ui/react-dropdown-menu';
import { FolderInput } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CollectionsIndex } from '../../api/collections';
import { useTopDialog } from '../../components/topLayer';

/** A keyboard and touch alternative to dropping covers on a collection tab. */
export function CollectionMoveMenu(props: {
  index: CollectionsIndex | undefined;
  disabled?: boolean;
  onMove: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const host = useTopDialog(open);
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="selection-action"
          disabled={props.disabled || !props.index}
        >
          <FolderInput size={14} />
          {t('works.collections.moveTo', { defaultValue: '移至合集' })}
        </button>
      </Menu.Trigger>
      <Menu.Portal container={host}>
        <Menu.Content className="menu" align="start" sideOffset={4}>
          <Menu.Item className="menu-item" onSelect={() => props.onMove(null)}>
            {t('works.collections.unfiled', { defaultValue: '未归类' })}
          </Menu.Item>
          {(props.index?.collections ?? []).map((collection) => (
            <Menu.Item
              key={collection.id}
              className="menu-item"
              onSelect={() => props.onMove(collection.id)}
            >
              {collection.name}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
