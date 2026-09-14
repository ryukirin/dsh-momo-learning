import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { KeyringSecretStore } from './auth/secret-store.js';
import { openDatabase } from './db/database.js';
import { diagnostic } from './redaction.js';
import { registerTools } from './tools/register-tools.js';
const main = async () => {
    const server = new McpServer({ name: 'momo-learning-mcp', version: '0.1.0' });
    registerTools(server, openDatabase(), new KeyringSecretStore());
    await server.connect(new StdioServerTransport());
    diagnostic('墨墨学习 MCP 已通过 stdio 启动。');
};
main().catch((error) => {
    diagnostic('MCP 启动失败。', error);
    process.exitCode = 1;
});
//# sourceMappingURL=server.js.map