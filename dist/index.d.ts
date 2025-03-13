import { WebdavServer } from "./module/webdav-server.js";
import * as func from './module/func.js';
import { ExpectedError } from "./module/expected-error.js";
import type { AuthInterface } from "./module/manager/auth-manager.js";
import type { ResourceLockInterface } from "./module/manager/resource-lock-manager.js";
import type { RequestHandler, WebdavServerOption } from './module/webdav-server.js';
declare const middlewares: {
    useViewer: RequestHandler;
};
export { WebdavServer, func, ExpectedError, middlewares };
export type { AuthInterface, ResourceLockInterface, RequestHandler, WebdavServerOption };
export default WebdavServer;
//# sourceMappingURL=index.d.ts.map