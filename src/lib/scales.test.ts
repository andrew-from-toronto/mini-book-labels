import { describe, expect, it } from 'vitest';
import { dimsAtScale, matchingScale, resizeProportionally } from './scales';

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
