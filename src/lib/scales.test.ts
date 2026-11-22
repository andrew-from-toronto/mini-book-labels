import { describe, expect, it } from 'vitest';
import { dimsAtScale, matchingScale, resizeProportionally, scaleForTree } from './scales';
import { TREE_SIZES } from './tree';

describe('scales', () => {
  it('gives the original default size at 1:7', () => {
    expect(dimsAtScale(7)).toEqual({ height: 30, width: 20, spine: 5 });
  });

  it('gives dollhouse size at 1:12', () => {
    expect(dimsAtScale(12)).toEqual({ height: 17.5, width: 11.7, spine: 2.9 });
  });

  it('recognises preset sizes and reports custom ones as null', () => {
    expect(matchingScale(dimsAtScale(12))).toBe(12);
    expect(matchingScale({ height: 30, width: 21, spine: 5 })).toBeNull();
  });

  it('scales the other dimensions when one is resized', () => {
    expect(resizeProportionally({ height: 30, width: 20, spine: 5 }, 'height', 45)).toEqual({
      height: 45,
      width: 30,
      spine: 7.5,
    });
  });
});

describe('scaleForTree', () => {
  it('picks 1:7 for a tabletop tree, 1:5 for a small one, and 1:4 for full-size trees', () => {
    expect(scaleForTree(TREE_SIZES.tabletop.height)).toBe(7);
    expect(scaleForTree(TREE_SIZES.small.height)).toBe(5);
    expect(scaleForTree(TREE_SIZES.medium.height)).toBe(4);
    expect(scaleForTree(TREE_SIZES.tall.height)).toBe(4);
  });
});
