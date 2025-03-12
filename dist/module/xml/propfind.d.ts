import { WebdavServer } from "../webdav-server.js";
export declare function createPropfindXML({ server, servicePath, depth }: PropfindArgs): string;
interface PropfindArgs {
    servicePath: string;
    depth?: 0 | 1;
    server: WebdavServer;
}
export {};
//# sourceMappingURL=propfind.d.ts.map