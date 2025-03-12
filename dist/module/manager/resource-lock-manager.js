import { ExpectedError } from "../expected-error.js";
export class ResourceLockManager {
    lockDataMap = new Map();
    lock(path, timeout = null, lockToken) {
        if (this.isLocked(path)) {
            throw new ExpectedError("ALREADY_LOCKED");
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
            };
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
    isLocked(path) {
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
    unlock(path, lockToken) {
        if (!this.isLocked(path)) {
            throw new ExpectedError("NOT_LOCKED");
        }
        if (typeof (lockToken) === "string") {
            if (this.lockDataMap.get(path)?.lockToken !== lockToken) {
                throw new ExpectedError("INVALID_LOCK_TOKEN");
            }
        }
        else {
            if (!lockToken.includes(this.lockDataMap.get(path)?.lockToken)) {
                throw new ExpectedError("INVALID_LOCK_TOKEN");
            }
        }
        const lockData = this.lockDataMap.get(path);
        if (!lockData) {
            return;
        }
        lockData.locked = false;
        lockData.lockToken = null;
        lockData.expiration = null;
        lockData.timeout = null;
    }
    unlockForce(path) {
        if (!this.isLocked(path)) {
            return;
        }
        const lockData = this.lockDataMap.get(path);
        if (!lockData)
            return;
        lockData.locked = false;
        lockData.lockToken = null;
        lockData.expiration = null;
        lockData.timeout = null;
    }
    getLockToken(path) {
        return this.lockDataMap.get(path)?.lockToken ?? null;
    }
    getExpiration(path) {
        return this.lockDataMap.get(path)?.expiration ?? null;
    }
    getTimeout(path) {
        return this.lockDataMap.get(path)?.timeout ?? null;
    }
    canUnlock(path, lockToken) {
        if (!this.isLocked(path)) {
            return false;
        }
        if (typeof (lockToken) === "string") {
            return this.getLockToken(path) === lockToken;
        }
        else {
            return lockToken.includes(this.getLockToken(path));
        }
    }
}
//# sourceMappingURL=resource-lock-manager.js.map