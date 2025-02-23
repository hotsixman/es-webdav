import { normalize } from "path";
import { ExpectedError } from "./expected-error.js";
import { getParentPath } from "./func.js";

export interface ResourceLockInterface {
    lock(path: string): string;
    isLocked(path: string): boolean;
    unlock(path: string, lockToken: string): void;
    unlockForce(path: string): void;
    getLockToken(path: string): string | null;
    isAncestorsLocked(path: string, rootPath: string): boolean;
    canUnlockAncestor(path: string, lockToken: any, rootPath: string): boolean;
}

type LockData = {
    locked: boolean;
    lockToken: string | null;
}

export class ResourceLockManager implements ResourceLockInterface {
    private lockDataMap: Map<string, LockData> = new Map();

    /**
     * 해당 경로 잠금
     * @throws `ALREADY_LOCKED` 해당 경로가 이미 잠겨있음
     */
    lock(path: string): string {
        if (this.isLocked(path)) {
            throw new ExpectedError("ALREADY_LOCKED")
        }
        const lockToken = crypto.randomUUID();
        let lockData = this.lockDataMap.get(path);
        if (!lockData) {
            lockData = {
                locked: false,
                lockToken: null
            }
            this.lockDataMap.set(path, lockData);
        }
        lockData.locked = true;
        lockData.lockToken = lockToken;
        return lockToken;
    }

    /**
     * 해당 경로가 잠겼는지 확인
     * @param path 
     * @returns 
     */
    isLocked(path: string) {
        return this.lockDataMap.get(path)?.locked ?? false
    }

    /**
     * @throws `NOT_LOCKED` 해당 경로가 잠겨있지 않음
     * @throws `INVALID_LOCK_TOKEN` 잠금 토큰이 일치하지 않음
     */
    unlock(path: string, lockToken: string) {
        if (!this.isLocked(path)) {
            throw new ExpectedError("NOT_LOCKED")
        }

        if (this.lockDataMap.get(path)?.lockToken !== lockToken) {
            throw new ExpectedError("INVALID_LOCK_TOKEN")
        }

        const lockData = this.lockDataMap.get(path)
        if (!lockData) {
            return
        }
        lockData.locked = false;
        lockData.lockToken = null;
    }

    unlockForce(path: string): void {
        if (!this.isLocked(path)) {
            return;
        }

        const lockData = this.lockDataMap.get(path);
        if(!lockData) return;

        lockData.locked = false;
        lockData.lockToken = null;
    }

    /**
     * 
     */
    getLockToken(path: string): string | null {
        return this.lockDataMap.get(path)?.lockToken ?? null;
    }

    isAncestorsLocked(path: string, rootPath: string): boolean {
        let ancestorsLocked = false;
        let ppath = getParentPath(path)
        while (true) {
            if (this.isLocked(ppath)) {
                ancestorsLocked = true;
                break;
            }
            if (normalize(path) === normalize(rootPath)) {
                break;
            }
            ppath = getParentPath(ppath);
        }
        return ancestorsLocked;
    }

    canUnlockAncestor(path: string, lockToken: any, rootPath: string): boolean {
        let canUnlock = false;
        let ppath = getParentPath(path)
        while (true) {
            if (this.isLocked(ppath)) {
                if (this.getLockToken(ppath) === lockToken) {
                    canUnlock = true;
                }
                break;
            }
            if (normalize(path) === normalize(rootPath)) {
                break;
            }
            ppath = getParentPath(ppath);
        }
        return canUnlock;
    }
}