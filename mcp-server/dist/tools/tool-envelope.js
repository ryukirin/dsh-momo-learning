export const envelope = (data, source, completeness = 'unknown', warnings = [], mirror) => ({
    data,
    source,
    mirror: mirror ?? {},
    completeness: { status: completeness, continuationAvailable: false },
    warnings
});
//# sourceMappingURL=tool-envelope.js.map