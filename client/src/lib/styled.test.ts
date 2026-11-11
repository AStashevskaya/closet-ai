import { readStyledParams, styledParams } from './styled';

describe('styled params', () => {
  test('leave out what the piece lacks', () => {
    expect(styledParams('req-1', { id: 'item-1', name: 'Skirt', photoUrl: '/p' }, null)).toEqual({
      id: 'req-1',
      item: 'item-1',
      name: 'Skirt',
      photoUrl: '/p',
    });
    expect(styledParams('req-1', { id: 'item-1', name: 'Skirt' }, 'office')).toEqual({
      id: 'req-1',
      item: 'item-1',
      name: 'Skirt',
      mood: 'office',
    });
  });

  test('read back what they wrote', () => {
    const params = styledParams(
      'req-1',
      { id: 'item-1', name: 'Skirt', cutoutUrl: '/c' },
      'evening',
    );
    expect(readStyledParams(params)).toEqual({
      requestId: 'req-1',
      piece: { id: 'item-1', name: 'Skirt', cutoutUrl: '/c' },
      mood: 'evening',
    });
  });

  test('read a link from elsewhere carefully', () => {
    // A repeated param counts once; an unknown mood is none.
    expect(
      readStyledParams({ id: 'req-1', item: ['item-1', 'item-2'], name: 'Skirt', mood: 'party' }),
    ).toEqual({ requestId: 'req-1', piece: { id: 'item-1', name: 'Skirt' }, mood: null });
    // Without the piece there is nothing to hang the thread from.
    expect(readStyledParams({ id: 'req-1' })).toBeNull();
    expect(readStyledParams({ id: 'req-1', item: 'item-1', name: '' })).toBeNull();
  });

  test('carry the kind for the hanger, and drop one that is not a kind', () => {
    const params = styledParams(
      'req-1',
      { id: 'item-1', name: 'Skirt', photoUrl: '/p', category: 'bottom' },
      null,
    );
    expect(readStyledParams(params)?.piece.category).toBe('bottom');
    expect(
      readStyledParams({ id: 'req-1', item: 'item-1', name: 'Skirt', category: 'hats' })?.piece,
    ).toEqual({ id: 'item-1', name: 'Skirt' });
  });
});
