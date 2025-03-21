import * as http1 from "node:http";
import * as http2 from "node:http2";
import * as fs from 'node:fs';
import * as mime from 'mime-types';
import { setHeader, joinPath, writeFile, decodePath, rmDirectory, resolvePath, getParentPath, isChildPath, getReqPath, getEtag, getLockToken, getTimeout, getDepth, lockPath } from "./func.js";
import { createPropfindXML } from "./xml/propfind.js";
import { createDeleteXML } from "./xml/delete.js";
import { ResourceLockManager } from "./manager/resource-lock-manager.js";
import { createLockXML } from "./xml/lock.js";
import { ExpectedError } from "./expected-error.js";
import { AuthManager } from "./manager/auth-manager.js";
import { extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { ConnectionManager } from "./manager/connection-manager.js";
function getHttp(version) {
    if (version === "http") {
        return http1;
    }
    else {
        return http2;
    }
}
export class WebdavServer {
    static methodHandler = {
        option(_, res) {
            res.statusCode = 200;
            setHeader(res, {
                'dav': '1',
                'allow': Object.keys(this.methodHandler).map(e => e.toUpperCase()).join(', '),
                'content-length': '0'
            });
            res.end();
            return;
        },
        async get(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getSourcePath(reqPath);
            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                res.write('Not found.');
                return res.end();
            }
            const fileStat = fs.statSync(filePath);
            if (fileStat.isDirectory()) {
                res.statusCode = 404;
                res.write('Not found.');
                return res.end();
            }
            const contentType = mime.lookup(extname(filePath));
            const range = req.headers.range;
            if (range) {
                const rangePart = range.replace('bytes=', '').trim().split(',')[0].trim();
                const [start, end] = rangePart.split('-').map((e, i, a) => {
                    if (e.length === 0) {
                        if (i === 0)
                            return 0;
                        return fileStat.size - 1;
                    }
                    else {
                        return parseInt(e);
                    }
                });
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
            else {
                res.statusCode = 200;
                setHeader(res, {
                    'content-type': contentType ? contentType + (contentType.startsWith('text') ? '; charset="utf-8"' : '') : "application/octet-stream",
                    'Content-Length': fileStat.size,
                    'accept-ranges': 'bytes',
                });
                await pipeline(fs.createReadStream(filePath), res);
                return res.end();
            }
        },
        async head(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getSourcePath(reqPath);
            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                res.write('Not found.');
                return res.end();
            }
            const fileStat = fs.statSync(filePath);
            if (fileStat.isDirectory()) {
                setHeader(res, {
                    'content-length': 0
                });
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
            });
            return res.end();
        },
        async put(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getSourcePath(reqPath);
            const lockToken = getLockToken(req);
            const alreadyExists = fs.existsSync(filePath);
            if (alreadyExists) {
                if (fs.statSync(filePath).isDirectory()) {
                    res.statusCode = 405;
                    return res.end();
                }
                const { overwrite } = req.headers;
                if (typeof (overwrite) === "string" && overwrite.toUpperCase() === "F") {
                    res.statusCode = 412;
                    return res.end();
                }
                if (server.lockManager.isLocked(reqPath) && !server.lockManager.canUnlock(reqPath, lockToken)) {
                    res.statusCode = 423;
                    return res.end();
                }
            }
            else {
                if (!fs.existsSync(getParentPath(filePath))) {
                    res.statusCode = 404;
                    return res.end();
                }
                const parentSourcePath = getParentPath(reqPath);
                if (server.lockManager.isLocked(parentSourcePath) && !server.lockManager.canUnlock(parentSourcePath, lockToken)) {
                    res.statusCode = 423;
                    return res.end();
                }
            }
            await writeFile(req, filePath);
            if (alreadyExists) {
                res.statusCode = 200;
            }
            else {
                res.statusCode = 201;
            }
            return res.end();
        },
        async propfind(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getSourcePath(reqPath);
            const depth = (Number(req.headers.depth) || 0);
            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                return res.end();
            }
            res.statusCode = 207;
            setHeader(res, {
                'Content-type': 'application/xml; charset="utf-8"',
                'dav': '1'
            });
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
            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                return res.end();
            }
            const lockToken = getLockToken(req);
            if (server.lockManager.isLocked(reqPath) && !server.lockManager.canUnlock(reqPath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }
            const parentReqPath = getParentPath(reqPath);
            if (server.lockManager.isLocked(parentReqPath) && !server.lockManager.canUnlock(parentReqPath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }
            const fileStat = fs.statSync(filePath);
            if (fileStat.isDirectory()) {
                res.statusCode = 207;
                setHeader(res, {
                    'Content-type': 'application/xml; charset="utf-8"'
                });
                const interval = setInterval(() => {
                    res.write("0");
                }, 1000 * 10);
                const removedPaths = rmDirectory(reqPath, server);
                const responseXML = createDeleteXML(removedPaths);
                clearInterval(interval);
                return res.end(responseXML);
            }
            else {
                res.statusCode = 204;
                const interval = setInterval(() => {
                    res.write("0");
                }, 1000 * 10);
                fs.rmSync(filePath);
                clearInterval(interval);
                return res.end();
            }
        },
        async move(req, res, server) {
            const reqPath = getReqPath(req);
            const originSourcePath = server.getSourcePath(reqPath);
            if (!fs.existsSync(originSourcePath)) {
                res.statusCode = 404;
                return res.end();
            }
            const originStat = fs.statSync(originSourcePath);
            const destinationHeader = req.headers.destination;
            if (!destinationHeader || typeof (destinationHeader) !== "string") {
                res.statusCode = 400;
                return res.end();
            }
            const destinationServicePath = decodePath(new URL(destinationHeader).pathname);
            const destinationFilePath = server.getSourcePath(destinationServicePath);
            const destinationAlreadyExists = fs.existsSync(destinationFilePath);
            const detinationParentServicePath = getParentPath(destinationServicePath);
            const destinationParentPath = getParentPath(destinationFilePath);
            if (originStat.isDirectory() && destinationAlreadyExists) {
                res.statusCode = 405;
                return res.end();
            }
            if (destinationAlreadyExists && fs.statSync(destinationFilePath).isDirectory()) {
                res.statusCode = 405;
                return res.end();
            }
            const lockToken = getLockToken(req);
            if (server.lockManager.isLocked(reqPath) && !server.lockManager.canUnlock(reqPath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }
            if (server.lockManager.isLocked(detinationParentServicePath) && !server.lockManager.canUnlock(detinationParentServicePath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }
            if (destinationAlreadyExists) {
                if (server.lockManager.isLocked(destinationServicePath) && !server.lockManager.canUnlock(destinationServicePath, lockToken)) {
                    res.statusCode = 423;
                    return res.end();
                }
            }
            else {
                if (!fs.existsSync(destinationParentPath)) {
                    res.statusCode = 404;
                    return res.end();
                }
            }
            if (typeof (req.headers.override) === "string" && req.headers.override.toUpperCase() === "F") {
                if (destinationAlreadyExists) {
                    res.statusCode = 409;
                    return res.end();
                }
            }
            res.statusCode = 200;
            const interval = setInterval(() => {
                res.write("0");
            }, 1000 * 10);
            fs.renameSync(originSourcePath, destinationFilePath);
            clearInterval(interval);
            return res.end();
        },
        async mkcol(req, res, server) {
            const reqPath = getReqPath(req);
            const sourcePath = server.getSourcePath(reqPath);
            if (fs.existsSync(sourcePath)) {
                res.statusCode = 405;
                return res.end();
            }
            const parentSourcePath = getParentPath(sourcePath);
            const parentServicePath = getParentPath(reqPath);
            const lockToken = getLockToken(req);
            if (!fs.existsSync(parentSourcePath)) {
                res.statusCode = 404;
                return res.end();
            }
            if (server.lockManager.isLocked(parentServicePath) && !server.lockManager.canUnlock(parentServicePath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }
            try {
                fs.mkdirSync(sourcePath);
            }
            catch (err) {
                if (err?.code === "ENOENT") {
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
            if (!fs.existsSync(originSourcePath) || fs.statSync(originSourcePath).isDirectory()) {
                res.statusCode = 404;
                return res.end();
            }
            const destinationHeader = req.headers.destination;
            if (!destinationHeader || typeof (destinationHeader) !== "string") {
                res.statusCode = 400;
                return res.end();
            }
            const destinationServicePath = decodePath(new URL(destinationHeader).pathname);
            const destinationFilePath = server.getSourcePath(destinationServicePath);
            const destinationAlreadyExists = fs.existsSync(destinationFilePath);
            const parentServicePath = getParentPath(destinationServicePath);
            const parentSourcePath = server.getSourcePath(parentServicePath);
            const lockToken = getLockToken(req);
            if (server.lockManager.isLocked(destinationServicePath) && !server.lockManager.canUnlock(destinationServicePath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }
            if (server.lockManager.isLocked(parentServicePath) && !server.lockManager.canUnlock(parentServicePath, lockToken)) {
                res.statusCode = 423;
                return res.end();
            }
            if (destinationAlreadyExists && fs.statSync(destinationFilePath).isDirectory()) {
                res.statusCode = 405;
                return res.end();
            }
            if (!fs.existsSync(parentSourcePath)) {
                res.statusCode = 404;
                return res.end();
            }
            if (typeof (req.headers.override) === "string" && req.headers.override.toUpperCase() === "F") {
                if (destinationAlreadyExists) {
                    res.statusCode = 409;
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
            }, 1000 * 10);
            fs.copyFileSync(originSourcePath, destinationFilePath);
            clearInterval(interval);
            return res.end();
        },
        async lock(req, res, server) {
            const reqPath = getReqPath(req);
            const sourcePath = server.getSourcePath(reqPath);
            if (!fs.existsSync(sourcePath)) {
                res.statusCode = 404;
                return res.end();
            }
            const timeout = getTimeout(req);
            const depth = getDepth(req);
            const lockToken = lockPath(reqPath, server, depth, timeout);
            if (lockToken) {
                const responseXML = createLockXML(lockToken, timeout);
                setHeader(res, {
                    'lock-token': `<opaquelocktoken:${lockToken}>`
                });
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
            if (!fs.existsSync(sourcePath)) {
                res.statusCode = 404;
                return res.end();
            }
            if (!server.lockManager.isLocked(reqPath)) {
                res.statusCode = 409;
                return res.end();
            }
            const lockToken = getLockToken(req);
            if (!server.lockManager.canUnlock(reqPath, lockToken)) {
                res.statusCode = 412;
                return res.end();
            }
            server.lockManager.unlock(reqPath, lockToken);
            res.statusCode = 200;
            return res.end();
        }
    };
    httpServer;
    option;
    lockManager = new ResourceLockManager();
    authManager = new AuthManager();
    connectionManager;
    thisServer = this;
    constructor(option) {
        this.option = {
            version: option?.version ?? 'http2',
            port: option?.port ?? 3000,
            middlewares: option?.middlewares,
            rootPath: resolvePath(process.cwd(), option?.rootPath ?? '.'),
            davRootPath: option?.davRootPath ?? '/dav',
            maxConnection: option?.maxConnection ?? 10
        };
        if (!this.option.rootPath.endsWith('/')) {
            this.option.rootPath += '/';
        }
        if (option?.virtualDirectory) {
            const vDirectoryMap = {};
            Object.entries(option?.virtualDirectory).forEach(([vPath, rPath]) => {
                let virtualPath = vPath;
                let realPath = resolvePath(process.cwd(), rPath);
                if (!realPath.endsWith('/')) {
                    realPath += '/';
                }
                if (!virtualPath.endsWith('/')) {
                    virtualPath += '/';
                }
                vDirectoryMap[virtualPath] = realPath;
            });
            this.option.virtualDirectory = vDirectoryMap;
        }
        if (option?.authManager) {
            this.authManager = option.authManager;
        }
        if (option?.lockManager) {
            this.lockManager = option.lockManager;
        }
        this.connectionManager = new ConnectionManager(this.option.maxConnection);
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
    getSourcePath(reqPath) {
        if (reqPath.startsWith(this.option.davRootPath)) {
            reqPath = reqPath.slice(this.option.davRootPath.length);
        }
        let sourcePath = "";
        if (!reqPath.endsWith('/')) {
            reqPath += '/';
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
    getServicePath(sourcePath) {
        let reqPath = '';
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
            reqPath = sourcePath.slice(this.option.rootPath.length);
        }
        if (!reqPath.startsWith('/')) {
            reqPath = '/' + reqPath;
        }
        if (reqPath.endsWith('/')) {
            reqPath = reqPath.slice(0, -1);
        }
        reqPath = joinPath('/dav', reqPath);
        return reqPath;
    }
    listen(callback) {
        this.httpServer.listen(this.option.port, callback);
    }
    async handleRequest(req, res) {
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
//# sourceMappingURL=webdav-server.js.map