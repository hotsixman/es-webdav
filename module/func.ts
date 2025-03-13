import { Http2ServerRequest, Http2ServerResponse, OutgoingHttpHeaders } from "node:http2";
import * as path from 'path';
import { WebdavServer } from "./webdav-server.js";
import * as fs from 'node:fs';

/**
 * `Record` 형식으로 응답 헤더를 추가
 * @param res 
 * @param header 
 */
export function setHeader(res: Http2ServerResponse, header: OutgoingHttpHeaders | Record<string, string | number | string[] | undefined>) {
    Object.entries(header).forEach(([name, value]) => {
        if (typeof (value) === "undefined") return;
        res.setHeader(name, value)
    })
}

/**
 * path를 join함. 윈도우 환경에서 `/`가 `\`로 되는 문제가 있어 slash 사용.
 * @param args 
 * @returns 
 */
export function joinPath(...args: string[]) {
    return slash(path.join(...args));
}
/**
 * path를 resolve함. 윈도우 환경에서 `/`가 `\`로 되는 문제가 있어 slash 사용.
 * @param args 
 * @returns 
 */
export function resolvePath(...args: string[]) {
    return slash(path.resolve(...args));
}
/**
 * 부모 경로를 가져옴. slash 사용.
 * @param pathname 
 * @returns 
 */
export function getParentPath(pathname: string): string {
    let dirname = path.dirname(pathname);
    if (dirname.endsWith('/')) {
        dirname = dirname.slice(0, -1)
    }
    return slash(dirname)
}
/**
 * `\`를 사용하는 경로를 `/`로 변경 
 * @param path 
 * @returns 
 */
export function slash(path: string) {
    return path.replace(/\\/g, '/');
}

/**
 * 요청으로 넘어오는 데이터를 파일에 작성
 */
export async function writeFile(req: Http2ServerRequest, filePath: string) {
    const writeStream = fs.createWriteStream(filePath);
    try {
        await new Promise<void>((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            req.pipe(writeStream);
        });
        writeStream.end();
    }
    catch (err) {
        writeStream.end();
        throw err;
    }
}

export function encodePath(path: string) {
    return path.split('/').map(encodeURIComponent).join('/');
}
export function decodePath(path: string) {
    return path.split('/').map(decodeURIComponent).join('/');
}

/**
 * pipe
 */
export function pipe(value: any, funcArr: ((arg: any) => any)[]) {
    for (const func of funcArr) {
        value = func(value);
    };
    return value;
}
export async function asyncPipe(value: any, funcArr: ((arg: any) => any | Promise<any>)[]) {
    for (const func of funcArr) {
        value = await func(value);
    };
    return value;
}

/**
 * 폴더와 하위 폴더 모두 삭제
 * 삭제 후 삭제 한 파일 및 폴더 전체의 경로 배열 반환(절대경로, 디코딩됨)
 * @param path 
 * @returns 
 */
export function rmDirectory(reqPath: string, server: WebdavServer) {
    const paths: string[] = [];
    const sourcePath = server.getSourcePath(reqPath);
    const subServicePaths = fs.readdirSync(sourcePath).map(e => joinPath(sourcePath, e)).map((e) => server.getServicePath(e));
    for (const subServicePath of subServicePaths) {
        const subSourcePath = server.getSourcePath(subServicePath);
        const fileStat = fs.statSync(subSourcePath);
        if (fileStat.isDirectory()) {
            const removedPaths = rmDirectory(subServicePath, server);
            paths.push(...removedPaths);
        }
        else {
            fs.rmSync(subSourcePath);
            paths.push(subServicePath);
        }
    }
    fs.rmdirSync(sourcePath);
    paths.push(reqPath);
    return paths;
}

/**
 * ```js
 * Regexp.escape
 * ```
 * @param string 
 * @returns 
 */
export function escapeRegexp(string: string) {
    if (typeof string !== 'string') {
        throw new TypeError('Expected a string');
    }

    return string
        .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
        .replace(/-/g, '\\x2d');
}

/**
 * Etag 반환
 * @param fileStat 
 * @returns 
 */
export function getEtag(fileStat: fs.Stats) {
    return `${fileStat.ino}-${fileStat.ctimeMs}-${fileStat.mtimeMs}`;
}

/**
 * `childPath` 가 `parentPath` 의 자손 경로인지 확인
 * @param parentPath 
 * @param childPath 
 * @returns 
 */
export function isChildPath(parentPath: string, childPath: string): boolean {
    if (!parentPath.endsWith('/')) {
        parentPath += "/"
    }
    if (!childPath.endsWith('/')) {
        childPath += '/'
    }

    return childPath.startsWith(parentPath)
}

/**
 * 두 경로가 같은 지 비교
 * @param parentPath 
 * @param childPath 
 * @returns 
 */
export function isSamePath(path1: string, path2: string): boolean {
    if (!path1.endsWith('/')) {
        path1 += "/"
    }
    if (!path2.endsWith('/')) {
        path2 += '/'
    }

    return path2.startsWith(path1)
}

export function getReqPath(req: Http2ServerRequest) {
    let reqPath = decodePath(req.url);
    if (reqPath !== "/" && reqPath.endsWith('/')) {
        reqPath = reqPath.slice(0, -1)
    }
    if(reqPath.includes('?')){
        reqPath = reqPath.split('?')[0];
    }
    return reqPath;
}

export function getReqParam(req: Http2ServerRequest){
    let reqPath = decodePath(req.url);
    return new URLSearchParams(reqPath.split('?')[1] ?? '')
}

/*
req에서 lock-token을 가져옴
*/
export function getLockToken(req: Http2ServerRequest): string | string[] {
    let lockToken = req.headers['lock-token'];
    if (typeof (lockToken) === "string") {
        if (lockToken.includes(",")) {
            return lockToken.split(",").map(e => e.trim());
        }
        else {
            return lockToken;
        }
    }
    else if (Array.isArray(lockToken)) {
        return lockToken;
    }
    else {
        return [];
    }
}

/*
req에서 timeout을 가져옴
*/
export function getTimeout(req: Http2ServerRequest): number | null {
    let timeoutHeader = req.headers['timeout'];
    if (typeof (timeoutHeader) !== "string") {
        return null;
    }
    timeoutHeader = timeoutHeader.toLowerCase();

    if (timeoutHeader.startsWith("second")) {
        return Number(timeoutHeader.replace(/^second\-/, '')) || null;
    }

    return null;
}

/**
req에서 Depth를 가져옴
*/
export function getDepth(req: Http2ServerRequest): number {
    const depth = req.headers.depth;

    if (depth === "infinity") {
        return Infinity;
    }
    if (!depth) {
        return 0;
    }

    return Number(depth) || 0;
}

/**
 * 특정 경로를 잠금
*/
export function lockPath(servicePath: string, server: WebdavServer, depth: number, timeout: number | null = null, lockToken?: string): string | null {
    //const lockedServicePath: string[] = [];

    const sourcePath = server.getSourcePath(servicePath);
    if (!fs.existsSync(sourcePath)) {
        return null;
    }

    try {
        const l = server.lockManager.lock(servicePath, timeout);
        if (!lockToken) {
            lockToken = l;
        }
    }
    catch {
        return null;
    }
    //lockedServicePath.push(servicePath);

    if (depth === Infinity) {
        if (fs.statSync(sourcePath).isDirectory()) {
            const entries = fs.readdirSync(sourcePath);
            if (servicePath === "/" && server.option.virtualDirectory) {
                entries.push(...Object.keys(server.option.virtualDirectory));
            }
            entries.forEach((entry) => {
                const entryServicePath = joinPath(servicePath, entry);
                lockPath(entryServicePath, server, depth, timeout, lockToken);
                //lockedServicePath.push(...locked);
            })
        }
    }

    return lockToken;
}

/**
 * 요청 헤더에서 유저와 패스워드를 반환
 * @param req 
 */
export function getAuth(req: Http2ServerRequest): [string, string] | null{
    const authHeader = req.headers.authorization;

    if(!authHeader){
        return null;
    }
    if(typeof(authHeader) !== "string"){
        return null;
    }

    const [authType, credentials] = authHeader.split(" ").map(e => e.trim());
    switch(authType){
        case("Basic"):{
            const decodedCredentials = atob(credentials);
            const [user, password] = decodedCredentials.split(":");
            return [user, password];
        }
    }

    return null;
}