import * as http1 from "node:http";
import * as http2 from "node:http2";
import * as fs from 'node:fs';
import * as mime from 'mime-types';
import { setHeader, joinPath, writeFile, decodePath, rmDirectory, escapeRegexp, slash, encodePath, resolvePath, getParentPath, isChildPath, getReqPath } from "./func.js";
import { createPropfindXML } from "./xml/propfind.js";
import { createDeleteXML } from "./xml/delete.js";
import { ResourceLockInterface, ResourceLockManager } from "./resource-lock-manager.js";

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
            const filePath = server.getFilePath(reqPath);

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
                res.statusCode = 404;
                res.write('Not found.');
                return res.end();
            }

            const contentType = mime.lookup(filePath);

            const range = req.headers.range;
            if (range) { // range 헤더가 있는 경우
                const rangePart = range.replace('bytes=', '').trim().split(',')[0].trim();
                const [start, end] = rangePart.split('-').map(parseInt);

                if (start < 0 || start >= fileStat.size || end < 0 || end >= fileStat.size) {
                    res.statusCode = 416;
                    setHeader(res, {
                        "content-range": `bytes */${fileStat.size}`
                    });
                    return res.end();
                }

                const chunkSize = end - start + 1;

                try {
                    await new Promise<void>((resolve, reject) => {
                        const fileStream = fs.createReadStream(filePath, { start, end });
                        fileStream.on('end', resolve);
                        fileStream.on('error', reject);
                        fileStream.pipe(res);
                    });
                    res.statusCode = 206;
                    setHeader(res, {
                        'accept-ranges': 'bypes',
                        'content-type': contentType || undefined,
                        'content-length': chunkSize,
                        "content-range": `bytes ${start}-${end}/${fileStat.size}`
                    });
                }
                catch {
                    res.statusCode = 500;
                }

                return res.end();
            }
            else { // range 헤더가 없는 경우
                try {
                    await new Promise<void>((resolve, reject) => {
                        const fileStream = fs.createReadStream(filePath);
                        fileStream.on('end', resolve);
                        fileStream.on('error', reject);
                        fileStream.pipe(res);
                    })
                    res.statusCode = 200;
                    setHeader(res, {
                        'content-type': contentType || undefined,
                        'content-length': fileStat.size
                    });
                }
                catch {
                    res.statusCode = 500;
                }

                return res.end();
            }
        },
        async head(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getFilePath(reqPath);

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
                res.statusCode = 200;
                setHeader(res, {
                    'content-length': 0
                })
                return res.end();
            }
            else {
                const contentType = mime.lookup(filePath);

                res.statusCode = 200;
                setHeader(res, {
                    'content-type': contentType || undefined,
                    'content-length': fileStat.size
                });
            }
            setHeader(res, {
                'allow': Object.keys(this.methodHandler).map(e => e.toUpperCase()).join(', '),
                'last-modified': fileStat.mtime.toUTCString(),
                etag: fileStat.ino
            })
            return res.end();
        },
        async put(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getFilePath(reqPath);

            // override 검사
            const { overwrite } = req.headers;
            if (typeof(overwrite) === "string" && (overwrite as string).toUpperCase() === "F") {
                res.statusCode = 412;
                return res.end();
            }

            // 잠금 검사
            const lockToken = req.headers['lock-token'];
            if(server.lockManager.isLocked(filePath)){
                if(lockToken !== server.lockManager.getLockToken(filePath)){
                    res.statusCode = 423;
                    return res.end();
                }
            }

            const alreadyExists = fs.existsSync(filePath);
            if(!alreadyExists){
                // 파일이 없는 경우 부모 폴더에 대해서도 잠금 검사
                const parentPath = getParentPath(filePath);
                if(server.lockManager.isLocked(parentPath)){
                    if(lockToken !== server.lockManager.getLockToken(parentPath)){
                        res.statusCode = 423;
                        return res.end();
                    }
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
        /**
         * @todo 
         * - `D:prop`에 사용할 `property` 추가
         */
        async propfind(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getFilePath(reqPath);

            let depth = (Number(req.headers.depth) || 0) as (0 | 1);

            /**
             * 경로에 아무것도 존재하지 않는 경우
             */
            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                return res.end();
            }

            try {
                res.statusCode = 207;
                setHeader(res, {
                    'Content-type': 'application/xml; charset="utf-8"',
                    'dav': '1'
                })
                const responseXML = createPropfindXML({
                    reqPath,
                    depth,
                    server
                });
                return res.end(responseXML);
            }
            catch (err) {
                console.log(err);
                return send500();
            }

            function send500() {
                res.statusCode = 500;
                res.write('<?xml version="1.0"?><error>500 Internal Server Error</error>');
                return res.end();
            }
        },
        async delete(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getFilePath(reqPath);

            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                return res.end();
            }

            /*
            잠금 검사
            삭제하려면 해당 리소스와 상위 폴더가 모두 잠겨있지 않아야함
            */
            const lockToken = req.headers['lock-token'];
            if(server.lockManager.isLocked(filePath)){
                if(lockToken !== server.lockManager.getLockToken(filePath)){
                    res.statusCode = 423;
                    return res.end();
                }
            }
            if(server.lockManager.isLocked(getParentPath(filePath))){
                if(lockToken !== server.lockManager.getLockToken(getParentPath(filePath))){
                    res.statusCode = 423;
                    return res.end();
                }
            }

            const fileStat = fs.statSync(filePath);

            if (fileStat.isDirectory()) {
                /*
                폴더를 삭제하는 경우
                해당 폴더와 모든 하위 리소스의 경로를 XML로 만들어 응답
                */
                const basePath = slash(server.option.rootPath);
                const removedPaths = rmDirectory(filePath).map(p => {
                    if (server.option.virtualDirectory) {
                        for (const [virtualPath, realPath] of Object.entries(server.option.virtualDirectory)) {
                            if (isChildPath(realPath, p)) {
                                return joinPath(virtualPath, p.replace(new RegExp(`^${realPath}(.*)`), '$1'));
                            }
                        }
                    }
                    return p.replace(new RegExp(`^${escapeRegexp(basePath)}(.*)`), '$1');
                });
                const responseXML = createDeleteXML(removedPaths);
                res.statusCode = 207;
                setHeader(res, {
                    'Content-type': 'application/xml; charset="utf-8"'
                })
                return res.end(responseXML);
            }
            else {
                /*
                파일을 삭제해는 경우
                해당 파일만 삭제하고 204 응답
                */
                fs.rmSync(filePath);
                res.statusCode = 204;
                return res.end();
            }
        },
        async move(req, res, server) {
            const reqPath = getReqPath(req);
            const filePath = server.getFilePath(reqPath);

            const sourceStat = fs.statSync(filePath);

            /*
            소스 경로가 존재하는 지 확인
            */
            if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                return res.end();
            }

            /*
            목적지 헤더가 존재하는지 확인
            */
            const destinationHeader = req.headers.destination;
            if (!destinationHeader || typeof (destinationHeader) !== "string") {
                res.statusCode = 400;
                return res.end();
            }

            // 목적지 경로
            const destinationPath = server.getFilePath(decodePath(new URL(destinationHeader).pathname));
            const destinationAlreadyExists = fs.existsSync(destinationPath);
            console.log(destinationPath)

            // 소스가 폴더이고 목적지 경로가 이미 존재하는 경우
            if(sourceStat.isDirectory() && destinationAlreadyExists){
                res.statusCode = 405;
                return res.end();
            }

            /*
            잠금 검사
            
            1. 목적지에 이미 파일이 존재하는 경우
            */

            /**
             * Override 검사
             */
            if (typeof (req.headers.override) === "string" && req.headers.override.toUpperCase() === "F") {
                if (destinationAlreadyExists) {
                    res.statusCode = 409; //conflict
                    return res.end();
                }
            }

            const destinationParentPath = getParentPath(destinationPath)
            if(!fs.existsSync(destinationParentPath)){
                fs.mkdirSync(destinationParentPath, {recursive: true});
            }
            fs.renameSync(filePath, destinationPath);

            return res.end();
        },
        async mkcol(req, res, server) {
            const reqPath = getReqPath(req);
            const sourcePath = server.getSourcePath(reqPath);

            if (fs.existsSync(sourcePath)) {
                res.statusCode = 405;
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
            const originPath = server.getSourcePath(reqPath);

            if (!fs.existsSync(originPath) || fs.statSync(originPath).isDirectory()) {
                res.statusCode = 404;
                return res.end();
            }

            const destinationHeader = req.headers.destination;
            if (!destinationHeader || typeof (destinationHeader) !== "string") {
                res.statusCode = 400;
                return res.end();
            }

            const destinationPath = server.getSourcePath(decodePath(new URL(destinationHeader).pathname));
            const destinationAlreadyExists = fs.existsSync(destinationPath);

            /**
             * Override 검사
             */
            if (typeof (req.headers.override) === "string" && req.headers.override.toUpperCase() === "F") {
                if (destinationAlreadyExists) {
                    res.statusCode = 409; //conflict
                    return res.end();
                }
            }

            const originStream = fs.createReadStream(originPath);
            const destinationStream = fs.createWriteStream(destinationPath);
            await new Promise<void>((res, rej) => {
                originStream.on('end', res);
                originStream.on('error', rej);
                originStream.pipe(destinationStream);
            });

            if (destinationAlreadyExists) {
                res.statusCode = 204;
            }
            else {
                res.statusCode = 201;
            }

            return res.end();
        }
    }

    // props
    httpServer: http1.Server | http2.Http2Server;
    option: WebdavServerOption;
    lockManager: ResourceLockInterface = new ResourceLockManager();

    constructor(option?: Partial<WebdavServerOption>) {
        this.option = {
            version: option?.version ?? 'http2',
            port: option?.port ?? 3000,
            middlewares: option?.middlewares,
            rootPath: resolvePath(process.cwd(), option?.rootPath ?? '.'),
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

        this.httpServer = getHttp(this.option.version).createServer(async (req, res) => {
            if (this.option.middlewares) {
                for (const middleware of this.option.middlewares) {
                    await middleware(req, res, this);
                    if (res.writableEnded) {
                        return;
                    }
                }
            }

            for (const [method, handler] of Object.entries(WebdavServer.methodHandler)) {
                if (req.method.toUpperCase() === method.toUpperCase()) {
                    return await handler(req, res, this);
                }
            }

            res.statusCode = 400;
            return res.end();
        });
    }

    /**
    서버 요청 경로를 실제 경로로 변환.
    인자와 반환값 모두 디코딩된 경로.
    */
    getSourcePath(reqPath: string) {
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
        if(!sourcePath){
            sourcePath = joinPath(this.option.rootPath, reqPath);
        }
        if(sourcePath.endsWith('/')){
            sourcePath = sourcePath.slice(0, -1);
        }
        return sourcePath;
    }
    getFilePath = this.getSourcePath;

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

        return reqPath;
    }

    listen() {
        this.httpServer.listen(this.option.port)
    }
}

type RequestHandler = (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse, server: WebdavServer) => any | Promise<any>;

interface WebdavServerOption {
    version: 'http' | 'http2';
    port: number;
    middlewares?: RequestHandler[];
    rootPath: string;
    virtualDirectory?: Record<string, string>;
}