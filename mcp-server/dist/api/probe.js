import { KeyringSecretStore } from '../auth/secret-store.js';
import { openDatabase } from '../db/database.js';
import { MaimemoClient } from './maimemo-client.js';
import { getTodayItems } from './today-items.js';
const run = async () => {
    if (!process.stdin.isTTY && !process.argv.includes('--yes')) {
        process.stdout.write('实时探针仅可在交互式终端或使用 --yes 显式确认后运行。\n');
        return;
    }
    const client = new MaimemoClient(new KeyringSecretStore());
    try {
        const items = await getTodayItems(client);
        const db = openDatabase();
        db.prepare(`INSERT INTO capability_flag(name,enabled,checked_at) VALUES('word_supplements',0,?) ON CONFLICT(name) DO UPDATE SET enabled=0,checked_at=excluded.checked_at`).run(new Date().toISOString());
        db.close();
        process.stdout.write(JSON.stringify({
            endpoint: 'get_today_items',
            returnedCount: items.length,
            wordSupplementCapability: '未确认'
        }) + '\n');
    }
    catch {
        process.stderr.write('探针未完成；未输出任何凭证或原始响应。\n');
        process.exitCode = 1;
    }
};
void run();
//# sourceMappingURL=probe.js.map