import { assetUrl } from '../api/client';
import type { Character } from '../api/types';

/** A character's face: the front reference if there is one, else the first letter. */
export function Avatar({ character, size = 28 }: { character: Character; size?: number }) {
  const refs = character.references ?? [];
  const ref = refs.find((r) => r.role === 'front') ?? refs[0];
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  return ref ? (
    <img
      className="avatar"
      style={style}
      src={assetUrl(ref.asset_id, 96)}
      alt={character.name}
      title={character.name}
      loading="lazy"
    />
  ) : (
    <span className="avatar" style={style} title={character.name} aria-label={character.name}>
      {(character.name || '?').slice(0, 1)}
    </span>
  );
}
