import { Entry } from '@napi-rs/keyring';
import { config } from '../config.js';
import { MaimemoError } from '../errors.js';
export class KeyringSecretStore {
    entryFactory;
    constructor(entryFactory = () => new Entry(config.credentialService, config.credentialAccount)) {
        this.entryFactory = entryFactory;
    }
    entry() {
        try {
            return this.entryFactory();
        }
        catch {
            throw new MaimemoError('CREDENTIAL_STORAGE_UNAVAILABLE', '无法访问操作系统安全凭证存储。');
        }
    }
    get() {
        try {
            return this.entry().getPassword() ?? undefined;
        }
        catch {
            throw new MaimemoError('CREDENTIAL_STORAGE_UNAVAILABLE', '无法读取操作系统安全凭证存储。');
        }
    }
    set(token) {
        if (!token.trim())
            throw new MaimemoError('INVALID_ARGUMENT', '访问凭证不能为空。');
        try {
            this.entry().setPassword(token.trim());
        }
        catch {
            throw new MaimemoError('CREDENTIAL_STORAGE_UNAVAILABLE', '无法写入操作系统安全凭证存储。');
        }
    }
    remove() {
        try {
            return this.entry().deletePassword();
        }
        catch {
            throw new MaimemoError('CREDENTIAL_STORAGE_UNAVAILABLE', '无法删除操作系统安全凭证。');
        }
    }
    available() {
        try {
            this.entry();
            return true;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=secret-store.js.map