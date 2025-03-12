export interface ResourceLockInterface {
    lock(path: string, timeout?: number | null, lockToken?: string): string;
    isLocked(path: string): boolean;
    unlock(path: string, lockToken: string | string[]): void;
    unlockForce(path: string): void;
    getLockToken(path: string): string | null;
    canUnlock(path: string, lockToken: string | string[]): boolean;
    getExpiration(path: string): Date | null;
    getTimeout(path: string): number | null;
}
export declare class ResourceLockManager implements ResourceLockInterface {
    private lockDataMap;
    lock(path: string, timeout?: number | null, lockToken?: string): string;
    isLocked(path: string): boolean;
    unlock(path: string, lockToken: string | string[]): void;
    unlockForce(path: string): void;
    getLockToken(path: string): string | null;
    getExpiration(path: string): Date | null;
    getTimeout(path: string): number | null;
    canUnlock(path: string, lockToken: string | string[]): boolean;
}
//# sourceMappingURL=resource-lock-manager.d.ts.map