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
export declare class KeyringSecretStore implements SecretStore {
    private readonly entryFactory;
    constructor(entryFactory?: () => CredentialEntry);
    private entry;
    get(): string | undefined;
    set(token: string): void;
    remove(): boolean;
    available(): boolean;
}
export {};
