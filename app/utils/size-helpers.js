/**
 * Utility functions for handling product sizes and categories
 */

/**
 * Guess product category from product name and variant titles
 * Returns: "tops", "bottoms", "shoes", "dresses", or null if unknown
 */
export function guessProductCategory(productName, variantTitle = '') {
  const text = `${productName} ${variantTitle}`.toLowerCase();

  // Shoes
  if (
    text.includes('shoe') ||
    text.includes('boot') ||
    text.includes('sneaker') ||
    text.includes('loafer') ||
    text.includes('sandal') ||
    text.includes('heels') ||
    text.includes('flats')
  ) {
    return 'shoes';
  }

  // Dresses
  if (text.includes('dress') || text.includes('gown')) {
    return 'dresses';
  }

  // Bottoms
  if (
    text.includes('pant') ||
    text.includes('jeans') ||
    text.includes('shorts') ||
    text.includes('skirt') ||
    text.includes('trousers') ||
    text.includes('legging')
  ) {
    return 'bottoms';
  }

  // Tops
  if (
    text.includes('shirt') ||
    text.includes('top') ||
    text.includes('blouse') ||
    text.includes('sweater') ||
    text.includes('hoodie') ||
    text.includes('t-shirt') ||
    text.includes('tee') ||
    text.includes('jacket') ||
    text.includes('cardigan') ||
    text.includes('vest')
  ) {
    return 'tops';
  }

  // Default to tops (most common)
  return 'tops';
}

/**
 * Extract size from variant title
 * Returns: "XS", "S", "M", "L", "XL", "XXL", "One Size", or null
 */
export function extractSizeFromVariant(variantTitle) {
  if (!variantTitle || variantTitle === 'Default Title') return null;

  const sizePatterns = ['XXL', 'XL', 'XS', 'S', 'M', 'L', 'One Size', '3XL', '2XL'];
  const titleUpper = variantTitle.toUpperCase();

  for (const pattern of sizePatterns) {
    if (titleUpper.includes(pattern)) {
      return pattern;
    }
  }

  return null;
}

/**
 * Checks if a product item has all required sizes selected
 */
export function hasSizeSelected(product) {
  return !!product.size;
}

/**
 * Filters products that are missing size selections
 */
export function getProductsWithoutSize(products) {
  return products.filter(p => !hasSizeSelected(p));
}
