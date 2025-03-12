import { ExpectedError } from "../expected-error.js";
export class AuthManager {
    userMap = new Map();
    async isRegistered(user) {
        return this.userMap.has(user);
    }
    async register(user, password) {
        if (await this.isRegistered(user)) {
            throw new ExpectedError("ALREADY_REGISTERED");
        }
        this.userMap.set(user, password);
    }
    async changePassword(user, newPassword) {
        if (!(await this.isRegistered(user))) {
            throw new ExpectedError("NOT_REGISTERED");
        }
        this.userMap.set(user, newPassword);
    }
    async deleteUser(user) {
        if (!(await this.isRegistered(user))) {
            throw new ExpectedError("NOT_REGISTERED");
        }
        this.userMap.delete(user);
    }
    async tryLogin(user, password) {
        if (!(await this.isRegistered(user))) {
            return false;
        }
        const userPassword = await this.getPassword(user);
        if (!userPassword) {
            return false;
        }
        return password === userPassword;
    }
    async getPassword(user) {
        if (!(await this.isRegistered(user))) {
            return null;
        }
        return this.userMap.get(user);
    }
}
//# sourceMappingURL=auth-manager.js.map