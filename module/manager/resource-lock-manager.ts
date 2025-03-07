import { normalize } from "path";
import { ExpectedError } from "../expected-error.js";
import { getParentPath } from "../func.js";

export interface ResourceLockInterface {
    lock(path: string, timeout?: number | null, lockToken?: string): string;
    isLocked(path: string): boolean;
    unlock(path: string, lockToken: string | string[]): void;
    unlockForce(path: string): void;
    getLockToken(path: string): string | null;
    canUnlock(path: string, lockToken: string | string[]): boolean;
    getExpiration(path: string): Date | null;
    getTimeout(path: string): number | null;

    //isAncestorsLocked(path: string, rootPath: string): boolean;
}

type LockData = {
    locked: boolean;
    lockToken: string | null;
    expiration: Date | null;
    timeout: number | null;
}

export class ResourceLockManager implements ResourceLockInterface {
    private lockDataMap: Map<string, LockData> = new Map();

    /**
     * 해당 경로 잠금
     * @param {number?} timeout 잠금 유지 시간(초단위) 
     * @throws `ALREADY_LOCKED` 해당 경로가 이미 잠겨있음
     */
    lock(path: string, timeout: number | null = null, lockToken?: string): string {
        if (this.isLocked(path)) {
            throw new ExpectedError("ALREADY_LOCKED")
        }
        if (!lockToken) {
            lockToken = crypto.randomUUID();
        }
        let lockData = this.lockDataMap.get(path);
        if (!lockData) {
            lockData = {
                locked: false,
                lockToken: null,
                expiration: null,
                timeout
            }
            this.lockDataMap.set(path, lockData);
        }
        lockData.locked = true;
        lockData.lockToken = lockToken;
        if (timeout) {
            lockData.expiration = new Date(Date.now() + timeout * 1000);
            lockData.timeout = timeout;
        }
        return lockToken;
    }

    /**
     * 해당 경로가 잠겼는지 확인
     * @param path 
     * @returns 
     */
    isLocked(path: string) {
        const lockData = this.lockDataMap.get(path);
        if (!lockData) {
            return false;
        }
        if (!lockData.locked) {
            return false;
        }
        if (lockData.expiration?.getTime() ?? 0 < Date.now()) {
            lockData.locked = false;
            lockData.lockToken = null;
            lockData.expiration = null;
            lockData.timeout = null;
            return false;
        }
        return true;
    }

    /**
     * @throws `NOT_LOCKED` 해당 경로가 잠겨있지 않음
     * @throws `INVALID_LOCK_TOKEN` 잠금 토큰이 일치하지 않음
     */
    unlock(path: string, lockToken: string | string[]) {
        if (!this.isLocked(path)) {
            throw new ExpectedError("NOT_LOCKED")
        }

        if (typeof (lockToken) === "string") {
            if (this.lockDataMap.get(path)?.lockToken !== lockToken) {
                throw new ExpectedError("INVALID_LOCK_TOKEN")
            }
        }
        else{
            if (!lockToken.includes(this.lockDataMap.get(path)?.lockToken as any)) {
                throw new ExpectedError("INVALID_LOCK_TOKEN")
            }
        }

        const lockData = this.lockDataMap.get(path)
        if (!lockData) {
            return
        }
        lockData.locked = false;
        lockData.lockToken = null;
        lockData.expiration = null;
        lockData.timeout = null;
    }

    unlockForce(path: string): void {
        if (!this.isLocked(path)) {
            return;
        }

        const lockData = this.lockDataMap.get(path);
        if (!lockData) return;

        lockData.locked = false;
        lockData.lockToken = null;
        lockData.expiration = null;
        lockData.timeout = null;
    }

    /**
     * 
     */
    getLockToken(path: string): string | null {
        return this.lockDataMap.get(path)?.lockToken ?? null;
    }

    getExpiration(path: string): Date | null {
        return this.lockDataMap.get(path)?.expiration ?? null;
    }

    getTimeout(path: string): number | null {
        return this.lockDataMap.get(path)?.timeout ?? null;
    }

    /*
    잠금을 풀 수 있는 지 여부
    즉, lockToken이 맞는 지 검사할 때 사용함.
    경로에 대해 잠금이 걸려있지 않다면 항상 false가 반환됨
    */
    canUnlock(path: string, lockToken: string | string[]): boolean {
        if (!this.isLocked(path)) {
            return false;
        }
        if (typeof (lockToken) === "string") {
            return this.getLockToken(path) === lockToken;
        }
        else {
            return lockToken.includes(this.getLockToken(path) as any);
        }
    }

    /*
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
    */
}