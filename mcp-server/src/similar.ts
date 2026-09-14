/**
 * Spelling similarity for building confusion questions.
 *
 * A newly learned word is rarely hard on its own; it is hard against the words it
 * looks or sounds like. The mirror already holds every word in the plan — exactly
 * the set the learner can actually confuse — so candidates are ranked locally with
 * no upstream call and no guessing by the model.
 */

/** Levenshtein distance between two spellings, case-insensitively. */
export const editDistance = (left: string, right: string): number => {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
};

/** Length of the shared leading characters of two spellings. */
export const commonPrefixLength = (left: string, right: string): number => {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
};

/** One candidate word to confuse the target with. */
export interface SimilarWord {
  wordId: string;
  spelling: string;
  /** Edit distance to the target. */
  distance: number;
  /** Shared leading characters, which is what makes look-alike pairs feel alike. */
  commonPrefix: number;
  /** Distance divided by the longer spelling, so pairs of any length compare fairly. */
  similarity: number;
}

/**
 * Rank words the target is easy to confuse with.
 *
 * Length is bounded first because a word twice as long is never a spelling
 * confusion; the rest is ordered by edit distance, then by shared prefix, so
 * `adapt`/`adopt` outranks a pair that merely shares a suffix. Words that differ
 * only in case or spacing are skipped as candidates, because they are the same
 * word rather than a confusion.
 * @param target - the spelling to find look-alikes for.
 * @param candidates - the words to rank, typically the whole plan.
 * @param limit - how many candidates to return.
 * @returns candidates ordered most confusable first.
 */
export const rankSimilarWords = (
  target: string,
  candidates: readonly { wordId: string; spelling: string }[],
  limit: number
): SimilarWord[] => {
  const normalized = target.trim();
  if (normalized.length === 0) return [];
  const scored: SimilarWord[] = [];
  for (const candidate of candidates) {
    const other = candidate.spelling;
    if (other.toLowerCase() === normalized.toLowerCase()) continue;
    if (Math.abs(other.length - normalized.length) > 3) continue;
    const distance = editDistance(normalized, other);
    const similarity = distance / Math.max(normalized.length, other.length);
    // Beyond this the pair shares too little to be a plausible mix-up.
    if (similarity > 0.45) continue;
    scored.push({
      wordId: candidate.wordId,
      spelling: other,
      distance,
      commonPrefix: commonPrefixLength(normalized, other),
      similarity: Number(similarity.toFixed(3))
    });
  }
  scored.sort(
    (left, right) =>
      left.distance - right.distance ||
      right.commonPrefix - left.commonPrefix ||
      left.spelling.localeCompare(right.spelling)
  );
  return scored.slice(0, limit);
};
