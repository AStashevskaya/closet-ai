import { type Item, outfitMood, type OutfitMood } from '@closet-ai/shared';

export type StyledPiece = { id: string; name: string; photoUrl?: string; cutoutUrl?: string };

// The params of `styled/[id]` for a closet piece's request: strings only, nothing left undefined.
export function styledParams(
  requestId: string,
  item: Pick<Item, 'id' | 'name' | 'photoUrl' | 'cutoutUrl'>,
  mood: OutfitMood | null,
) {
  return {
    id: requestId,
    item: item.id,
    name: item.name,
    ...(item.photoUrl && { photoUrl: item.photoUrl }),
    ...(item.cutoutUrl && { cutoutUrl: item.cutoutUrl }),
    ...(mood && { mood }),
  };
}

type RawParams = Record<string, string | string[] | undefined>;

// Back from the URL, which may not have come from styledParams (a deep link, a restored state):
// a repeated param counts once, an unknown mood is none. null without the piece's id or name.
export function readStyledParams(params: RawParams) {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) || undefined;
  };
  const [id, item, name] = [one('id'), one('item'), one('name')];
  if (!id || !item || !name) return null;
  const piece: StyledPiece = { id: item, name };
  const photoUrl = one('photoUrl');
  const cutoutUrl = one('cutoutUrl');
  if (photoUrl) piece.photoUrl = photoUrl;
  if (cutoutUrl) piece.cutoutUrl = cutoutUrl;
  const mood = outfitMood.safeParse(one('mood'));
  return { requestId: id, piece, mood: mood.success ? mood.data : null };
}
