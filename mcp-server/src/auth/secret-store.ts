import { Entry } from '@napi-rs/keyring';
import { config } from '../config.js';
import { MaimemoError } from '../errors.js';

export interface SecretStore {
  get(): string | undefined;
  set(token: string): void;
  remove(): boolean;
  available(): boolean;
}

interface CredentialEntry {
  getPassword(): string | null;
  setPassword(token: string): void;
  deletePassword(): boolean;
}

export class KeyringSecretStore implements SecretStore {
  constructor(
    private readonly entryFactory: () => CredentialEntry = () =>
      new Entry(config.credentialService, config.credentialAccount)
  ) {}

  private entry(): CredentialEntry {
    try {
      return this.entryFactory();
    } catch {
      throw new MaimemoError('CREDENTIAL_STORAGE_UNAVAILABLE', '无法访问操作系统安全凭证存储。');
    }
  }

  get(): string | undefined {
    try {
      return this.entry().getPassword() ?? undefined;
    } catch {
      throw new MaimemoError('CREDENTIAL_STORAGE_UNAVAILABLE', '无法读取操作系统安全凭证存储。');
    }
  }

  set(token: string): void {
    if (!token.trim()) throw new MaimemoError('INVALID_ARGUMENT', '访问凭证不能为空。');
    try {
      this.entry().setPassword(token.trim());
    } catch {
      throw new MaimemoError('CREDENTIAL_STORAGE_UNAVAILABLE', '无法写入操作系统安全凭证存储。');
    }
  }

  remove(): boolean {
    try {
      return this.entry().deletePassword();
    } catch {
      throw new MaimemoError('CREDENTIAL_STORAGE_UNAVAILABLE', '无法删除操作系统安全凭证。');
    }
  }

  available(): boolean {
    try {
      this.entry();
      return true;
    } catch {
      return false;
    }
  }
}
