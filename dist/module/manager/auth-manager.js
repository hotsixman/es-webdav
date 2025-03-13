import { ExpectedError } from "../expected-error.js";
import { DB } from 'johnson-db';
export class AuthManager {
    userMap = new Map();
    db = new DB('db/auth');
    constructor() {
        Object.values(this.db.select().run({ async: false })).forEach(({ user, password }) => {
            this.userMap.set(user, password);
        });
    }
    async isRegistered(user) {
        return this.userMap.has(user);
    }
    async register(user, password) {
        if (await this.isRegistered(user)) {
            throw new ExpectedError("ALREADY_REGISTERED");
        }
        this.userMap.set(user, password);
        this.db.insert({ user, password });
    }
    async changePassword(user, newPassword) {
        if (!(await this.isRegistered(user))) {
            throw new ExpectedError("NOT_REGISTERED");
        }
        this.userMap.set(user, newPassword);
        this.db.update().where((data) => data.user === user).to((data) => ({ ...data, password: newPassword })).run({ async: false });
    }
    async deleteUser(user) {
        if (!(await this.isRegistered(user))) {
            throw new ExpectedError("NOT_REGISTERED");
        }
        this.userMap.delete(user);
        this.db.delete().where((data) => data.user === user).run({ async: false });
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