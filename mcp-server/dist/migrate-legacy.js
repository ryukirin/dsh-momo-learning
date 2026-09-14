/**
 * One-shot migration from the names this mirror carried before it was published
 * as a DeepSeek Harness plugin.
 *
 * Two things were renamed: the OS credential-store service and the local app-data
 * directory. Both are *locations*, not contents, so nothing here rewrites data —
 * it moves the database beside its sidecars and copies the stored credential from
 * the old keyring entry to the new one. Upstream can rebuild the plan mirror in a
 * single call, but the mistake book and past daily snapshots exist only locally,
 * which is why the database is moved rather than recreated.
 *
 * The credential copy is an operation on the secret store, so it follows the same
 * rule as the credential CLI: it needs an interactive terminal, or an explicit
 * `--yes` in a non-interactive one.
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Entry } from '@napi-rs/keyring';
import { config } from './config.js';
/** The names this project used before the rename. */
const legacy = {
    credentialService: 'codex.maimemo-learning-mcp',
    dataDirectoryName: 'CodexMomoLearning'
};
const localRoot = () => process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? process.cwd(), 'AppData', 'Local');
/** Sidecars SQLite keeps beside a WAL database; moving the database alone would lose committed pages. */
const sidecarSuffixes = ['', '-wal', '-shm'];
const migrateDatabase = () => {
    const root = localRoot();
    const target = join(root, config.dataDirectoryName, 'learning.sqlite');
    const source = join(root, legacy.dataDirectoryName, 'learning.sqlite');
    if (!existsSync(source))
        return `数据库：旧位置没有文件，无需迁移（${source}）`;
    if (existsSync(target))
        return `数据库：新位置已有文件，保留不改（${target}）`;
    mkdirSync(dirname(target), { recursive: true });
    let moved = 0;
    for (const suffix of sidecarSuffixes) {
        const from = `${source}${suffix}`;
        if (!existsSync(from))
            continue;
        renameSync(from, `${target}${suffix}`);
        moved += 1;
    }
    return `数据库：已把 ${moved} 个文件从 ${dirname(source)} 移到 ${dirname(target)}`;
};
const migrateCredential = (allowed) => {
    const read = (service) => {
        try {
            return new Entry(service, config.credentialAccount).getPassword() ?? undefined;
        }
        catch {
            return undefined;
        }
    };
    const legacyToken = read(legacy.credentialService);
    if (legacyToken === undefined)
        return '凭证：旧服务名下没有凭证，无需迁移。';
    if (read(config.credentialService) !== undefined) {
        return `凭证：新服务名 ${config.credentialService} 下已有凭证，保留不改；旧凭证仍在，可在确认后自行删除。`;
    }
    if (!allowed) {
        return '凭证：检测到旧服务名下的凭证，但当前不是交互式终端。请重新运行时加上 --yes 以复制凭证。';
    }
    new Entry(config.credentialService, config.credentialAccount).setPassword(legacyToken);
    return `凭证：已从 ${legacy.credentialService} 复制到 ${config.credentialService}；旧条目仍在，确认无误后可自行删除。`;
};
const run = () => {
    const allowed = process.stdin.isTTY || process.argv.includes('--yes');
    // Each step is independent and reported on its own: a running DSH host keeps the
    // database open, which makes the move fail on Windows, and that must not stop the
    // credential from being copied.
    try {
        process.stdout.write(`${migrateDatabase()}\n`);
    }
    catch (error) {
        process.stdout.write(`数据库：迁移失败（${String(error)}）\n`);
        process.stdout.write('  多半是 DSH 还在运行、MCP 子进程占着数据库文件。请先停掉 DSH 再重跑本命令。\n');
    }
    try {
        process.stdout.write(`${migrateCredential(allowed)}\n`);
    }
    catch (error) {
        process.stdout.write(`凭证：迁移失败（${String(error)}）\n`);
    }
    process.stdout.write('提示：迁移只搬运位置，不修改任何账号数据。\n');
};
run();
//# sourceMappingURL=migrate-legacy.js.map