const secretPatterns = [/Bearer\s+[^\s]+/gi, /authorization\s*[:=]\s*[^\s,]+/gi];

export const redact = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return secretPatterns.reduce((result, pattern) => result.replace(pattern, '[已隐藏]'), value);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        /token|authorization|secret|password/i.test(key) ? key : key,
        /token|authorization|secret|password/i.test(key) ? '[已隐藏]' : redact(item)
      ])
    );
  }
  return value;
};

export const diagnostic = (message: string, details?: unknown): void => {
  const suffix = details === undefined ? '' : ` ${JSON.stringify(redact(details))}`;
  process.stderr.write(`${message}${suffix}\n`);
};
