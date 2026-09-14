import type Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SecretStore } from '../auth/secret-store.js';
export declare const registerTools: (server: McpServer, db: Database.Database, secrets: SecretStore) => void;
