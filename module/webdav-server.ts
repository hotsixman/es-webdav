import * as http1 from "node:http";
import * as http2 from "node:http2";
import * as fs from 'node:fs';
import * as mime from 'mime-types';
import { setHeader, joinPath, writeFile, decodePath, rmDirectory, escapeRegexp, slash, encodePath, resolvePath, getParentPath, isChildPath, getReqPath, getEtag, getLockToken, getTimeout, getDepth, lockPath } from "./func.js";
import { createPropfindXML } from "./xml/propfind.js";
import { createDeleteXML } from "./xml/delete.js";
import { ResourceLockInterface, ResourceLockManager } from "./manager/resource-lock-manager.js";
import { createLockXML } from "./xml/lock.js";
import { ExpectedError } from "./expected-error.js";
import { AuthInterface, AuthManager } from "./manager/auth-manager.js";
import { extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { ConnectionManager } from "./manager/connection-manager.js";

function getHttp(version: 'http' | 'http2') {
    if (version === "http") {
        return http1 as unknown as typeof http2;
    }
    else {
        return http2;
    }
}

export class WebdavServer {
    // static
    /**
     * @todo (PROPPATCH), LOCK, UNLOCK
     */
    static methodHandler: Record<string, RequestHandler> = {
        option(_, res) {
            res.statusCode = 200;
            setHeader(res, {
                'dav': '1',
                'allow': Object.keys(this.methodHandler).map(e => e.toUpperCase()).join(', '),
                'content-length': '0'
            })
            res.end();
            return;
        },
        async get(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getSourcePath(reqPath);

            /*
            경로에 리소스가 존재하지 않으면 404 응답
            */
            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                res.write('Not found.');
                return res.end();
            }

            const fileStat = fs.statSync(filePath);
            /*
            해당 경로가 디렉토리인 경우 404 응답
            */
            if (fileStat.isDirectory()) {
                res.statusCode = 404;
                res.write('Not found.');
                return res.end();
            }

            /*
            contentType 헤더 준비
            */
            const contentType = mime.lookup(extname(filePath));

            const range = req.headers.range;
            if (range) { // range 헤더가 있는 경우
                const rangePart = range.replace('bytes=', '').trim().split(',')[0].trim();
                const [start, end] = rangePart.split('-').map((e, i, a) => {
                    if (e.length === 0) {
                        if (i === 0) return 0;
                        return fileStat.size - 1;
                    }
                    else {
                        return parseInt(e)
                    }
                });

                /*
                올바르지 않은 범위
                */
                if (start < 0 || start >= fileStat.size || end < 0 || end >= fileStat.size) {
                    res.statusCode = 416;
                    setHeader(res, {
                        "content-range": `bytes */${fileStat.size}`
                    });
                    return res.end();
                }

                const chunkSize = end - start + 1;

                res.statusCode = 206;
                setHeader(res, {
                    'accept-ranges': 'bytes',
                    'content-type': contentType ? contentType + (contentType.startsWith('text') ? '; charset="utf-8"' : '') : "application/octet-stream",
                    'Content-Length': chunkSize,
                    "content-range": `bytes ${start}-${end}/${fileStat.size}`
                });
                await pipeline(fs.createReadStream(filePath, { start, end }), res);
                return res.end();
            }
            else { // range 헤더가 없는 경우
                res.statusCode = 200;
                setHeader(res, {
                    'content-type': contentType ? contentType + (contentType.startsWith('text') ? '; charset="utf-8"' : '') : "application/octet-stream",
                    'Content-Length': fileStat.size,
                    'accept-ranges': 'bytes',
                });
                await pipeline(fs.createReadStream(filePath), res)
                return res.end();
            }
        },
        async head(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getSourcePath(reqPath);

            /*
            경로에 리소스가 존자해지 않는 경우 404 응답
            */
            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                res.write('Not found.');
                return res.end();
            }

            const fileStat = fs.statSync(filePath);

            /**
             * 해당 경로가 디렉토리인 경우
             */
            if (fileStat.isDirectory()) {
                setHeader(res, {
                    'content-length': 0
                })
            }
            else {
                const contentType = mime.lookup(extname(filePath));
                setHeader(res, {
                    'content-type': contentType || undefined,
                    'content-length': fileStat.size,
                    'accept-ranges': 'bytes'
                });
            }
            res.statusCode = 200;
            setHeader(res, {
                'allow': Object.keys(WebdavServer.methodHandler).map(e => e.toUpperCase()).join(', '),
                'last-modified': fileStat.mtime.toUTCString(),
                etag: getEtag(fileStat)
            })
            return res.end();
        },
        async put(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getSourcePath(reqPath);

            /*
            잠금 토큰
            */
            const lockToken = getLockToken(req);

            const alreadyExists = fs.existsSync(filePath);
            /*
            경로에 리소스가 존재하는 경우
            */
            if (alreadyExists) {
                /*
                경로에 폴더가 존재하는 경우 405 응답
                */
                if (fs.statSync(filePath).isDirectory()) {
                    res.statusCode = 405;
                    return res.end();
                }
                /*
                Overwrite 헤더가 "F"일 경우 412 응답
                */
                const { overwrite } = req.headers;
                if (typeof (overwrite) === "string" && (overwrite as string).toUpperCase() === "F") {
                    res.statusCode = 412;
                    return res.end();
                }
                /*
                경로의 리소스에 대한 잠금 검사
                */
                if (server.lockManager.isLocked(reqPath) && !server.lockManager.canUnlock(reqPath, lockToken)) {
                    res.statusCode = 423;
                    return res.end();
                }
            }
            /*
            경로에 리소스가 존재하지 않는 경우
            */
            else {
                /*
                부모 폴더가 없는 경우 404 응답
                */
                if (!fs.existsSync(getParentPath(filePath))) {
                    res.statusCode = 404;
                    return res.end();
                }
                /*
                부모 폴더 잠금 검사
                */
                const parentSourcePath = getParentPath(reqPath);
                if (server.lockManager.isLocked(parentSourcePath) && !server.lockManager.canUnlock(parentSourcePath, lockToken)) {
                    res.statusCode = 423;
                    return res.end();
                }
            }

            await writeFile(req, filePath);
            if (alreadyExists) {
                /*
                새로 파일을 생성한 경우 200 응답
                */
                res.statusCode = 200;
            }
            else {
                /*
                파일을 덮어 쓴 경우 201 응답
                */
                res.statusCode = 201;
            }
            return res.end();
        },
        /**
         * @todo 
         * - `D:prop`에 사용할 `property` 추가
         */
        async propfind(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getSourcePath(reqPath);

            const depth = (Number(req.headers.depth) || 0) as (0 | 1);

            /**
             * 경로에 리소스가 존재하지 않는 경우
             */
            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                return res.end();
            }

            res.statusCode = 207;
            setHeader(res, {
                'Content-type': 'application/xml; charset="utf-8"',
                'dav': '1'
            })
            const responseXML = createPropfindXML({
                servicePath: reqPath,
                depth,
                server
            });
            return res.end(responseXML);
        },
        async delete(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getSourcePath(reqPath);

            /*
            경로에 리소스가 존재하지 않는 경우 404 응답
            */
            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                return res.end();
            }

            const lockToken = getLockToken(req);
            /*
            경로의 리소스에 대한 잠금 검사
            */
            if (server.lockManager.isLocked(reqPath) && !server.lockManager.canUnlock(reqPath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }
            /*
            부모 폴더에 대한 잠금 검사
            */
            const parentReqPath = getParentPath(reqPath)
            if (server.lockManager.isLocked(parentReqPath) && !server.lockManager.canUnlock(parentReqPath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }

            const fileStat = fs.statSync(filePath);

            if (fileStat.isDirectory()) {
                /*
                폴더를 삭제하는 경우
                해당 폴더와 모든 하위 리소스를 삭제하고 그 경로를 XML로 만들어 207 응답
                */
                res.statusCode = 207;
                setHeader(res, {
                    'Content-type': 'application/xml; charset="utf-8"'
                })
                const interval = setInterval(() => {
                    res.write("0")
                }, 1000 * 10);
                const removedPaths = rmDirectory(reqPath, server);
                const responseXML = createDeleteXML(removedPaths);
                clearInterval(interval);
                return res.end(responseXML);
            }
            else {
                /*
                파일을 삭제해는 경우
                해당 파일만 삭제하고 204 응답
                */
                res.statusCode = 204;
                const interval = setInterval(() => {
                    res.write("0")
                }, 1000 * 10);
                fs.rmSync(filePath);
                clearInterval(interval);
                return res.end();
            }
        },
        async move(req, res, server) {
            const reqPath = getReqPath(req);
            const originSourcePath = server.getSourcePath(reqPath);

            /*
            출발지에 리소스가 존재하는 지 확인
            */
            if (!fs.existsSync(originSourcePath)) {
                res.statusCode = 404;
                return res.end();
            }

            const originStat = fs.statSync(originSourcePath);

            /*
            목적지 헤더가 존재하는지 확인
            */
            const destinationHeader = req.headers.destination;
            if (!destinationHeader || typeof (destinationHeader) !== "string") {
                res.statusCode = 400;
                return res.end();
            }

            // 목적지 경로
            const destinationServicePath = decodePath(new URL(destinationHeader).pathname);
            const destinationFilePath = server.getSourcePath(destinationServicePath);
            const destinationAlreadyExists = fs.existsSync(destinationFilePath);
            const detinationParentServicePath = getParentPath(destinationServicePath);
            const destinationParentPath = getParentPath(destinationFilePath);

            // 출발지가 폴더이고 목적지 경로가 이미 존재하는 경우 405 응답
            if (originStat.isDirectory() && destinationAlreadyExists) {
                res.statusCode = 405;
                return res.end();
            }
            // 만약 목적지 경로에 폴더가 존재하는 경우 405 응답
            if (destinationAlreadyExists && fs.statSync(destinationFilePath).isDirectory()) {
                res.statusCode = 405;
                return res.end();
            }

            /*
            잠금 검사
            1. 목적지에 이미 파일이 존재하는 경우
                - 출발지가 잠겨있지 않아야 함
                - 목적지 파일이 잠겨있지 않아야 함
                - 목적지 파일의 부모 폴더가 잠겨있지 않아야 함
            2. 목적지에 아무것도 없는 경우
                - 출발지가 잠겨있지 않아야 함
                - 목적지의 부모 폴더가 존재해야 함
                - 목적지의 부모 폴더가 잠겨있지 않아야 함
            */
            const lockToken = getLockToken(req);
            /*
            출발지 잠금 검사
            */
            if (server.lockManager.isLocked(reqPath) && !server.lockManager.canUnlock(reqPath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }
            /*
            목적지 부모 폴더 잠금 검사
            */
            if (server.lockManager.isLocked(detinationParentServicePath) && !server.lockManager.canUnlock(detinationParentServicePath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }
            /*
            목적지에 파일이 존재하는 경우 목적지 파일 잠금 검사
            */
            if (destinationAlreadyExists) {
                if (server.lockManager.isLocked(destinationServicePath) && !server.lockManager.canUnlock(destinationServicePath, lockToken)) {
                    res.statusCode = 423;
                    return res.end();
                }
            }
            /*
            목적지에 파일이 존재하지 않는 경우 부모 폴더 존재 여부 검사
            */
            else {
                // 부모 폴더 존재 여부
                if (!fs.existsSync(destinationParentPath)) {
                    res.statusCode = 404;
                    return res.end();
                }
            }

            /**
             * Override 검사
             */
            if (typeof (req.headers.override) === "string" && req.headers.override.toUpperCase() === "F") {
                if (destinationAlreadyExists) {
                    res.statusCode = 409; //conflict
                    return res.end();
                }
            }

            res.statusCode = 200;
            const interval = setInterval(() => {
                res.write("0")
            }, 1000 * 10);
            fs.renameSync(originSourcePath, destinationFilePath);
            clearInterval(interval);
            return res.end();
        },
        async mkcol(req, res, server) {
            const reqPath = getReqPath(req);
            const sourcePath = server.getSourcePath(reqPath);

            /*
            이미 경로에 리소스가 존재하는 경우
            */
            if (fs.existsSync(sourcePath)) {
                res.statusCode = 405;
                return res.end();
            }

            const parentSourcePath = getParentPath(sourcePath);
            const parentServicePath = getParentPath(reqPath);
            const lockToken = getLockToken(req);
            /*
            부모 폴더가 존재하는 지 검사
            */
            if (!fs.existsSync(parentSourcePath)) {
                res.statusCode = 404;
                return res.end();
            }
            /*
            부모 폴더 잠금 검사
            */
            if (server.lockManager.isLocked(parentServicePath) && !server.lockManager.canUnlock(parentServicePath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }

            try {
                fs.mkdirSync(sourcePath);
            }
            catch (err) {
                if ((err as any)?.code === "ENOENT") {
                    res.statusCode = 409;
                    return res.end();
                }
                throw err;
            }

            res.statusCode = 201;
            return res.end();
        },
        async copy(req, res, server) {
            const reqPath = getReqPath(req);
            const originSourcePath = server.getSourcePath(reqPath);

            /*
            출발지에 리소스가 없거나 폴더이면 404 응답
            */
            if (!fs.existsSync(originSourcePath) || fs.statSync(originSourcePath).isDirectory()) {
                res.statusCode = 404;
                return res.end();
            }

            const destinationHeader = req.headers.destination;
            if (!destinationHeader || typeof (destinationHeader) !== "string") {
                res.statusCode = 400;
                return res.end();
            }

            const destinationServicePath = decodePath(new URL(destinationHeader).pathname)
            const destinationFilePath = server.getSourcePath(destinationServicePath);
            const destinationAlreadyExists = fs.existsSync(destinationFilePath);
            const parentServicePath = getParentPath(destinationServicePath);
            const parentSourcePath = server.getSourcePath(parentServicePath);

            // 목적지 리소스와 부모 폴더에 대한 잠금 검사
            const lockToken = getLockToken(req);
            if (server.lockManager.isLocked(destinationServicePath) && !server.lockManager.canUnlock(destinationServicePath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }
            if (server.lockManager.isLocked(parentServicePath) && !server.lockManager.canUnlock(parentServicePath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }

            // 만약 목적지에 폴더가 있다면 405 응담
            if (destinationAlreadyExists && fs.statSync(destinationFilePath).isDirectory()) {
                res.statusCode = 405;
                return res.end();
            }
            // 목적지의 부모 폴더가 없으면
            if (!fs.existsSync(parentSourcePath)) {
                res.statusCode = 404;
                return res.end();
            }

            /**
             * Override 검사
             */
            if (typeof (req.headers.override) === "string" && req.headers.override.toUpperCase() === "F") {
                if (destinationAlreadyExists) {
                    res.statusCode = 409; //conflict
                    return res.end();
                }
            }

            if (destinationAlreadyExists) {
                res.statusCode = 204;
            }
            else {
                res.statusCode = 201;
            }
            const interval = setInterval(() => {
                res.write("0");
            }, 1000 * 10)
            fs.copyFileSync(originSourcePath, destinationFilePath);
            clearInterval(interval);

            return res.end();
        },
        /**
         * @todo? lockscope에 shared 구현 - 권한 관리 추가 이후
         * @todo createLockXML 완성
        */
        async lock(req, res, server) {
            const reqPath = getReqPath(req);
            const sourcePath = server.getSourcePath(reqPath);

            /*
            경로에 리소스가 없는 경우 404 응답
            */
            if (!fs.existsSync(sourcePath)) {
                res.statusCode = 404;
                return res.end();
            }

            const timeout = getTimeout(req);
            const depth = getDepth(req);

            // lock이 성공하면 잠금 토큰(string)을 반환
            const lockToken = lockPath(reqPath, server, depth, timeout);
            if (lockToken) {
                const responseXML = createLockXML(lockToken, timeout);
                setHeader(res, {
                    'lock-token': `<opaquelocktoken:${lockToken}>`
                })
                res.write(responseXML);
                return res.end();
            }
            else {
                throw new ExpectedError("LOCK_FAILED");
            }
        },
        async unlock(req, res, server) {
            const reqPath = getReqPath(req);
            const sourcePath = server.getSourcePath(reqPath);

            /* 소스 경로에 리소스가 없는 경우 */
            if (!fs.existsSync(sourcePath)) {
                res.statusCode = 404;
                return res.end();
            }

            /* 소스의 리소스가 잠겨있지 않는 경우 */
            if (!server.lockManager.isLocked(reqPath)) {
                res.statusCode = 409;
                return res.end();
            }

            const lockToken = getLockToken(req);

            /* 잠금 토큰이 잘못된 경우 */
            if (!server.lockManager.canUnlock(reqPath, lockToken)) {
                res.statusCode = 412;
                return res.end();
            }

            server.lockManager.unlock(reqPath, lockToken);
            res.statusCode = 200;
            return res.end();
        }
    }

    // props
    httpServer: http1.Server | http2.Http2Server;
    option: WebdavServerOption;
    lockManager: ResourceLockInterface = new ResourceLockManager();
    authManager: AuthInterface = new AuthManager();
    connectionManager: ConnectionManager;
    thisServer = this;

    // constructor
    constructor(option?: WebdavServerConstructorOption) {
        this.option = {
            version: option?.version ?? 'http2',
            port: option?.port ?? 3000,
            middlewares: option?.middlewares,
            rootPath: resolvePath(process.cwd(), option?.rootPath ?? '.'),
            davRootPath: option?.davRootPath ?? '/dav',
            maxConnection: option?.maxConnection ?? 10
        }
        if (!this.option.rootPath.endsWith('/')) {
            this.option.rootPath += '/'
        }
        if (option?.virtualDirectory) {
            const vDirectoryMap: Record<string, string> = {}
            Object.entries(option?.virtualDirectory).forEach(([vPath, rPath]) => {
                let virtualPath = vPath;
                let realPath = resolvePath(process.cwd(), rPath);
                if (!realPath.endsWith('/')) {
                    realPath += '/'
                }
                if (!virtualPath.endsWith('/')) {
                    virtualPath += '/'
                }
                vDirectoryMap[virtualPath] = realPath;
            })
            this.option.virtualDirectory = vDirectoryMap;
        }
        if (option?.authManager) {
            this.authManager = option.authManager;
        }
        if (option?.lockManager) {
            this.lockManager = option.lockManager;
        }

        this.connectionManager = new ConnectionManager(this.option.maxConnection);

        // 서버 생성
        this.httpServer = getHttp(this.option.version).createServer(async (req, res) => {
            const connectionCreated = this.connectionManager.createConnection(req);
            if (!connectionCreated) {
                res.statusCode = 429;
                return res.end();
            }

            await this.handleRequest(req, res);
            this.connectionManager.destroyConnection(req);
        });
    }

    /**
    서버 요청 경로를 실제 경로로 변환.
    인자와 반환값 모두 디코딩된 경로.
    */
    getSourcePath(reqPath: string) {
        if (reqPath.startsWith(this.option.davRootPath)) {
            reqPath = reqPath.slice(this.option.davRootPath.length)
        }

        let sourcePath: string = "";
        if (!reqPath.endsWith('/')) {
            reqPath += '/'
        }

        if (this.option.virtualDirectory) {
            for (const [virtualPath, realPath] of Object.entries(this.option.virtualDirectory)) {
                if (isChildPath(virtualPath, reqPath)) {
                    sourcePath = joinPath(realPath, reqPath.replace(new RegExp(`^${virtualPath}(.*)`), '$1'));
                }
            }
        }
        if (!sourcePath) {
            sourcePath = joinPath(this.option.rootPath, reqPath);
        }
        if (sourcePath.endsWith('/')) {
            sourcePath = sourcePath.slice(0, -1);
        }
        return sourcePath;
    }
    /**
    실제 경로를 서버 요청 경로로 변환.
    인자와 반환값 모두 디코딩된 경로.
    */
    getServicePath(sourcePath: string) {
        let reqPath: string = '';
        if (this.option.virtualDirectory) {
            for (const [virtualPath, realPath] of Object.entries(this.option.virtualDirectory)) {
                if (isChildPath(realPath, sourcePath)) {
                    reqPath = joinPath(virtualPath, sourcePath.replace(new RegExp(`^${realPath}(.*)`), '$1'));
                }
            }
        }
        if (!reqPath) {
            if (!isChildPath(this.option.rootPath, sourcePath)) {
                return '';
            }
            reqPath = sourcePath.slice(this.option.rootPath.length)
        }

        if (!reqPath.startsWith('/')) {
            reqPath = '/' + reqPath;
        }
        if (reqPath.endsWith('/')) {
            reqPath = reqPath.slice(0, -1)
        }

        reqPath = joinPath('/dav', reqPath);

        return reqPath;
    }

    listen(callback?: () => void) {
        this.httpServer.listen(this.option.port, callback);
    }

    async handleRequest(req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) {
        try {
            if (this.option.middlewares) {
                for (const middleware of this.option.middlewares) {
                    await middleware(req, res, this);
                    if (res.writableEnded) {
                        return;
                    }
                }
            }

            if (getReqPath(req).startsWith(this.option.davRootPath)) {
                for (const [method, handler] of Object.entries(WebdavServer.methodHandler)) {
                    if (req.method.toUpperCase() === method.toUpperCase()) {
                        return await handler(req, res, this);
                    }
                }
            }

            res.statusCode = 400;
            return res.end();
        }
        catch (err) {
            console.error(err);
            res.statusCode = 500;
            return res.end();
        }
    }
}

export type RequestHandler = (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse, server: WebdavServer) => any | Promise<any>;

export interface WebdavServerOption {
    version: 'http' | 'http2';
    port: number;
    middlewares?: RequestHandler[];
    rootPath: string;
    davRootPath: string;
    virtualDirectory?: Record<string, string>;
    lockManager?: ResourceLockInterface;
    authManager?: AuthInterface;
    maxConnection: number;
}

export type WebdavServerConstructorOption = Partial<WebdavServerOption>