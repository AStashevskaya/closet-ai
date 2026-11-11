import {
  itemCategory,
  type Item,
  type ItemCategory,
  outfitMood,
  type OutfitMood,
} from '@closet-ai/shared';

export type StyledPiece = {
  id: string;
  name: string;
  photoUrl?: string;
  cutoutUrl?: string;
  // Its kind, for the hanger it waits on; missing on a link made before it was passed.
  category?: ItemCategory;
};

// The params of `styled/[id]` for a closet piece's request: strings only, nothing left undefined.
export function styledParams(
  requestId: string,
  item: Pick<Item, 'id' | 'name' | 'photoUrl' | 'cutoutUrl'> & { category?: ItemCategory },
  mood: OutfitMood | null,
) {
  return {
    id: requestId,
    item: item.id,
    name: item.name,
    ...(item.photoUrl && { photoUrl: item.photoUrl }),
    ...(item.cutoutUrl && { cutoutUrl: item.cutoutUrl }),
    ...(item.category && { category: item.category }),
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
  const category = itemCategory.safeParse(one('category'));
  if (category.success) piece.category = category.data;
  const mood = outfitMood.safeParse(one('mood'));
  return { requestId: id, piece, mood: mood.success ? mood.data : null };
}
