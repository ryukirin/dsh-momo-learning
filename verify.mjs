/**
 * Self-check for an installed dsh-momo-learning bundle.
 *
 * Run it from inside the profile directory the bundle was installed into, so
 * `@deepseek-ai/dsh-app-boot` and this package both resolve:
 *
 *     cp <bundle>/verify.mjs "$DSH_HOME/profiles/<profile>/"
 *     cd "$DSH_HOME/profiles/<profile>"
 *     node verify.mjs
 *
 * It boots the same composition the launcher boots — every `dsh-base` layer
 * plus this bundle's `cordis.patch.yml` — then asserts the two things the
 * bundle promises: the `momo-daily-learning` skill is in the registry catalog,
 * and all nineteen `mcp__maimemo__*` tools were discovered from the bundled stdio
 * server. It writes nothing beyond the ordinary boot artifacts and disposes the
 * tree before exiting.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const require = createRequire(import.meta.url)
const rootConfig = join(import.meta.dirname, 'cordis.yml')

let basePatch
let bundlePatch
try {
    basePatch = require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')
    bundlePatch = require.resolve('dsh-momo-learning/cordis.patch.yml')
} catch (error) {
    console.error(
        'Cannot resolve the packages to verify. Run this file from inside the profile\n'
        + 'directory that has both @deepseek-ai/dsh-base and dsh-momo-learning installed.\n'
        + String(error),
    )
    process.exit(1)
}
console.log(`bundle patch: ${bundlePatch}`)

/** The model-facing name of every tool the bundle must publish. */
const expectedTools = [
    'maimemo_auth_status', 'maimemo_backfill_study_records', 'maimemo_clear_local_learning_data', 'maimemo_find_similar_words',
    'maimemo_get_daily_todo', 'maimemo_get_day_state', 'maimemo_get_learning_overview', 'maimemo_get_word_supplements',
    'maimemo_list_local_words', 'maimemo_list_quiz_candidates', 'maimemo_list_quiz_mistakes', 'maimemo_open_daily_todo', 'maimemo_query_local_records', 'maimemo_record_quiz_mistakes',
    'maimemo_refresh_study_records', 'maimemo_sync_study_record_window',
    'maimemo_sync_today_snapshot', 'maimemo_sync_word_supplements', 'maimemo_update_daily_todo',
].map(tool => `mcp__maimemo__${tool}`)

const failures = []
const patches = [
    ...loadOverlayPatches('verify-dsh-momo-learning', basePatch),
    ...loadOverlayPatches('verify-dsh-momo-learning', bundlePatch),
]
const ctx = await boot('verify-dsh-momo-learning', rootConfig, patches)
try {
    const skills = ctx.get('skills')
    const catalog = await skills.list()
    if (catalog.every(entry => entry.name !== 'momo-daily-learning')) {
        failures.push(`skill missing; catalog = ${catalog.map(entry => entry.name).join(', ') || '(empty)'}`)
    } else {
        const loaded = await skills.get('momo-daily-learning')
        console.log(`skill momo-daily-learning: source=${loaded.source} body=${loaded.content.length} chars`)
        if (!loaded.content.includes('墨墨每日学习流程')) failures.push('skill body is not the daily-learning workflow')
    }

    const names = new Set(ctx.get('tools').schemas().map(schema => schema.name))
    for (const name of expectedTools) if (!names.has(name)) failures.push(`tool missing: ${name}`)
    console.log(`mcp tools: ${expectedTools.filter(name => names.has(name)).length}/${expectedTools.length}`)

    const paths = ctx.get('momoLearningPaths')
    if (paths?.serverScript === undefined) failures.push('service momoLearningPaths is not published')
    else console.log(`server script: ${paths.serverScript}`)
} finally {
    await ctx.fiber.dispose()
}

if (failures.length > 0) {
    console.error(`FAIL\n - ${failures.join('\n - ')}`)
    process.exitCode = 1
} else {
    console.log('PASS')
}
