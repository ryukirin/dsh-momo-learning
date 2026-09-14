export type Completeness = 'complete' | 'partial' | 'unknown';

export const envelope = <T>(
  data: T,
  source: 'upstream' | 'local_mirror',
  completeness: Completeness = 'unknown',
  warnings: string[] = [],
  mirror?: Record<string, unknown>
) => ({
  data,
  source,
  mirror: mirror ?? {},
  completeness: { status: completeness, continuationAvailable: false },
  warnings
});
