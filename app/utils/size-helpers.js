/**
 * Utility functions for handling product sizes and categories
 */

/**
 * Guess product category from product name and variant titles.
 * Returns: "tops", "bottoms", or "footwear"
 *
 * Logic covers the broadest range of fashion brands:
 *  - footwear: anything you put on your feet
 *  - bottoms:  anything worn on the lower body (incl. dresses/skirts — they
 *              share the same size chart as bottoms at most brands)
 *  - tops:     everything else (default fallback)
 */
export function guessProductCategory(productName, variantTitle = '') {
  const text = `${productName} ${variantTitle}`.toLowerCase();

  // ── Footwear ────────────────────────────────────────────────────────────────
  if (
    text.includes('shoe') ||
    text.includes('boot') ||
    text.includes('sneaker') ||
    text.includes('loafer') ||
    text.includes('sandal') ||
    text.includes('heel') ||
    text.includes('flat') ||
    text.includes('mule') ||
    text.includes('clog') ||
    text.includes('slipper') ||
    text.includes('pump') ||
    text.includes('stiletto') ||
    text.includes('wedge') ||
    text.includes('espadrille') ||
    text.includes('trainer') ||
    text.includes('footwear')
  ) {
    return 'footwear';
  }

  // ── Bottoms (incl. dresses / skirts — same size charts at most brands) ──────
  if (
    text.includes('pant') ||
    text.includes('jean') ||
    text.includes('denim') ||
    text.includes('short') ||
    text.includes('skirt') ||
    text.includes('trouser') ||
    text.includes('legging') ||
    text.includes('jogger') ||
    text.includes('sweatpant') ||
    text.includes('trackpant') ||
    text.includes('capri') ||
    text.includes('culotte') ||
    text.includes('bermuda') ||
    text.includes('dress') ||
    text.includes('gown') ||
    text.includes('jumpsuit') ||
    text.includes('romper') ||
    text.includes('playsuit') ||
    text.includes('overall') ||
    text.includes('dungaree')
  ) {
    return 'bottoms';
  }

  // ── Tops (default) ──────────────────────────────────────────────────────────
  // shirt, tee, top, blouse, sweater, hoodie, jacket, coat, cardigan,
  // vest, bodysuit, crop, corset, bra, tank, polo, sweatshirt, etc.
  return 'tops';
}

/**
 * Extract size from variant title
 * Returns: "XS", "S", "M", "L", "XL", "XXL", "One Size", or null
 */
export function extractSizeFromVariant(variantTitle) {
  if (!variantTitle || variantTitle === 'Default Title') return null;

  const title = variantTitle.trim();
  const titleUpper = title.toUpperCase();

  // Shoe sizes — check first (numeric, e.g. "EU 38", "US 8.5", "8", "8.5")
  const shoeMatch = title.match(/\b(\d{1,2}(?:\.\d)?)\b/);
  if (shoeMatch) {
    const num = parseFloat(shoeMatch[1]);
    if (num >= 4 && num <= 14) return shoeMatch[1];
  }

  // Apparel sizes — order matters (longer patterns first to avoid 'XL' matching inside 'XXL')
  const sizePatterns = ['XXXL', 'XXL', 'XL', 'XXS', 'XS', 'One Size', 'OS', 'S', 'M', 'L'];
  for (const pattern of sizePatterns) {
    // Match as whole word to avoid false positives
    const re = new RegExp(`(^|[^A-Z])${pattern}([^A-Z]|$)`);
    if (re.test(titleUpper)) {
      return pattern === 'OS' ? 'One Size' : pattern;
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
