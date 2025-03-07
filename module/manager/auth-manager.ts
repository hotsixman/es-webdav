import { ExpectedError } from "../expected-error.js";

export interface AuthInterface {
    isRegistered(user: string): Promise<boolean>;
    /**
     * @throws `ALREADY_REGISTERED` 이미 가입된 유저에 대해 가입하려고 시도함
     */
    register(user: string, password: string): Promise<void>;
    /**
     * @throws `NOT_REGISTERED` 가입되지 않은 유저에 대해 비밀번호를 바꾸려고 시도함
     */
    changePassword(user: string, newPassword: string): Promise<void>;
    /**
     * @throws `NOT_REGISTERED` 가입되지 않은 유저를 삭제하려고 시도함
     */
    deleteUser(user: string): Promise<void>;
    tryLogin(user: string, password: string): Promise<boolean>;
    getPassword(user: string): Promise<string | null>;
}

export class AuthManager implements AuthInterface {
    userMap = new Map<string, string>();

    async isRegistered(user: string): Promise<boolean> {
        return this.userMap.has(user);
    }

    async register(user: string, password: string) {
        if (await this.isRegistered(user)) {
            throw new ExpectedError("ALREADY_REGISTERED");
        }

        this.userMap.set(user, password);
    }

    async changePassword(user: string, newPassword: string): Promise<void> {
        if (!(await this.isRegistered(user))) {
            throw new ExpectedError("NOT_REGISTERED");
        }

        this.userMap.set(user, newPassword);
    }

    async deleteUser(user: string): Promise<void> {
        if (!(await this.isRegistered(user))) {
            throw new ExpectedError("NOT_REGISTERED");
        }

        this.userMap.delete(user);
    }

    async tryLogin(user: string, password: string): Promise<boolean> {
        if (!(await this.isRegistered(user))) {
            return false;
        }

        const userPassword = await this.getPassword(user);

        if(!userPassword){
            return false;
        }

        return password === userPassword;
    }

    async getPassword(user: string): Promise<string | null> {
        if(!(await this.isRegistered(user))){
            return null;
        }

        return this.userMap.get(user) as string;
    }
}