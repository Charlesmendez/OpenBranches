import { describe, expect, it } from 'vitest';
import { pageWindow } from '../src/ui/pagination';

describe('bounded pagination', () => {
  it('returns the requested slice and range metadata', () => {
    expect(pageWindow(['a', 'b', 'c', 'd', 'e'], 1, 2)).toEqual({
      page: 1,
      pageCount: 3,
      start: 2,
      items: ['c', 'd'],
    });
  });

  it('clamps obsolete and invalid positions after results change', () => {
    expect(pageWindow(['a'], 50, 2)).toMatchObject({ page: 0, pageCount: 1, items: ['a'] });
    expect(pageWindow(['a', 'b'], -2, 0)).toMatchObject({
      page: 0,
      pageCount: 2,
      items: ['a'],
    });
    expect(pageWindow([], Number.NaN, 2)).toEqual({
      page: 0,
      pageCount: 1,
      start: 0,
      items: [],
    });
  });
});
