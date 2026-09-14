/**
 * Spelling similarity for building confusion questions.
 *
 * A newly learned word is rarely hard on its own; it is hard against the words it
 * looks or sounds like. The mirror already holds every word in the plan — exactly
 * the set the learner can actually confuse — so candidates are ranked locally with
 * no upstream call and no guessing by the model.
 */
/** Levenshtein distance between two spellings, case-insensitively. */
export declare const editDistance: (left: string, right: string) => number;
/** Length of the shared leading characters of two spellings. */
export declare const commonPrefixLength: (left: string, right: string) => number;
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
export declare const rankSimilarWords: (target: string, candidates: readonly {
    wordId: string;
    spelling: string;
}[], limit: number) => SimilarWord[];
