import * as http1 from "node:http";
import * as http2 from "node:http2";
import { ResourceLockInterface } from "./manager/resource-lock-manager.js";
import { AuthInterface } from "./manager/auth-manager.js";
export declare class WebdavServer {
    static methodHandler: Record<string, RequestHandler>;
    httpServer: http1.Server | http2.Http2Server;
    option: WebdavServerOption;
    lockManager: ResourceLockInterface;
    authManager: AuthInterface;
    thisServer: this;
    constructor(option?: Partial<WebdavServerOption>);
    getSourcePath(reqPath: string): string;
    getServicePath(sourcePath: string): string;
    listen(callback?: () => void): void;
}
type RequestHandler = (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse, server: WebdavServer) => any | Promise<any>;
interface WebdavServerOption {
    version: 'http' | 'http2';
    port: number;
    middlewares?: RequestHandler[];
    rootPath: string;
    davRootPath: string;
    virtualDirectory?: Record<string, string>;
    lockManager?: ResourceLockInterface;
    authManager?: AuthInterface;
}
export {};
//# sourceMappingURL=webdav-server.d.ts.map