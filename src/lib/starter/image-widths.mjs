/**
 * Keep a small, sorted set of responsive widths at or below the intrinsic size.
 * An empty result means use the original image rather than generating variants.
 * @param {number} intrinsicWidth
 * @param {readonly number[]} candidates
 * @returns {number[]}
 */
export function boundedImageWidths(intrinsicWidth, candidates) {
  if (!Number.isSafeInteger(intrinsicWidth) || intrinsicWidth < 1) {
    throw new Error('Intrinsic width must be a positive integer.');
  }
  if (!candidates.every((width) => Number.isSafeInteger(width) && width > 0)) {
    throw new Error('Candidate widths must be positive integers.');
  }
  return [...new Set(candidates.filter((width) => width <= intrinsicWidth))].sort((a, b) => a - b);
}
