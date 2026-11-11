import { describe, expect, it } from 'vitest';
import { averageColor, colorFromText, hslToRgb, textColorOn } from './color';
import { cleanTitle, pinterestVariants, searchUrl, wrapSearchUrls } from './covers';

describe('color', () => {
  it('picks light text on dark backgrounds and dark text on light ones', () => {
    expect(textColorOn([20, 30, 60])).toEqual([250, 250, 250]);
    expect(textColorOn([240, 230, 200])).toEqual([24, 24, 24]);
  });

  it('averages RGBA pixels, ignoring alpha', () => {
    expect(averageColor([0, 0, 0, 255, 100, 200, 50, 0])).toEqual([50, 100, 25]);
  });

  it('converts HSL primaries', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
  });

  it('derives a stable colour from text', () => {
    expect(colorFromText('Piranesi')).toEqual(colorFromText('Piranesi'));
  });
});

describe('cover lookup helpers', () => {
  it('strips series suffixes and subtitles from titles', () => {
    expect(cleanTitle('Dune (Dune #1)')).toBe('Dune');
    expect(cleanTitle('Sapiens: A Brief History of Humankind')).toBe('Sapiens');
  });

  it('searches by cleaned title and first author', () => {
    const url = new URL(searchUrl({ title: 'Dune (Dune #1)', authors: 'Frank Herbert, Someone Else' }), 'https://minibookornaments.com');
    expect(url.searchParams.get('title')).toBe('Dune');
    expect(url.searchParams.get('author')).toBe('Frank Herbert');
  });

  it('lists larger Pinterest versions, originals first, and nothing for other links', () => {
    expect(pinterestVariants('https://i.pinimg.com/736x/1b/65/d7/abc.jpg')).toEqual([
      'https://i.pinimg.com/originals/1b/65/d7/abc.png',
      'https://i.pinimg.com/originals/1b/65/d7/abc.jpg',
      'https://i.pinimg.com/1200x/1b/65/d7/abc.jpg',
    ]);
    expect(pinterestVariants('https://example.com/736x/abc.jpg')).toEqual([]);
  });

  it('builds full-wrap search links from cleaned title and first author', () => {
    const { pinterest } = wrapSearchUrls({ title: 'Dune (Dune #1)', authors: 'Frank Herbert, Someone Else' });
    expect(new URL(pinterest).searchParams.get('q')).toBe('Dune Frank Herbert full book cover spine back');
  });
});
