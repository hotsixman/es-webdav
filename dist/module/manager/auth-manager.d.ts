export interface AuthInterface {
    isRegistered(user: string): Promise<boolean>;
    register(user: string, password: string): Promise<void>;
    changePassword(user: string, newPassword: string): Promise<void>;
    deleteUser(user: string): Promise<void>;
    tryLogin(user: string, password: string): Promise<boolean>;
    getPassword(user: string): Promise<string | null>;
}
export declare class AuthManager implements AuthInterface {
    userMap: Map<string, string>;
    isRegistered(user: string): Promise<boolean>;
    register(user: string, password: string): Promise<void>;
    changePassword(user: string, newPassword: string): Promise<void>;
    deleteUser(user: string): Promise<void>;
    tryLogin(user: string, password: string): Promise<boolean>;
    getPassword(user: string): Promise<string | null>;
}
//# sourceMappingURL=auth-manager.d.ts.map