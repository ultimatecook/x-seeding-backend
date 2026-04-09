import { describe, expect, it } from 'vitest';
import {
  extractSizeFromVariant,
  getProductsWithoutSize,
  guessProductCategory,
  hasSizeSelected,
} from '../../app/utils/size-helpers';

describe('size-helpers smoke', () => {
  it('detecta categorias de productos', () => {
    expect(guessProductCategory('Classic Leather Boot')).toBe('footwear');
    expect(guessProductCategory('Slim Denim Jeans')).toBe('bottoms');
    expect(guessProductCategory('Cotton Tee')).toBe('tops');
  });

  it('extrae tallas de variantes comunes', () => {
    expect(extractSizeFromVariant('Size M')).toBe('M');
    expect(extractSizeFromVariant('US 8.5')).toBe('8.5');
    expect(extractSizeFromVariant('Default Title')).toBeNull();
  });

  it('valida productos sin talla seleccionada', () => {
    const products = [
      { id: '1', size: 'M' },
      { id: '2', size: '' },
      { id: '3', size: null },
    ];

    expect(hasSizeSelected(products[0])).toBe(true);
    expect(hasSizeSelected(products[1])).toBe(false);
    expect(getProductsWithoutSize(products)).toHaveLength(2);
  });
});
