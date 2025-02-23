import { Http2ServerRequest, Http2ServerResponse, OutgoingHttpHeaders } from "node:http2";
import * as path from 'path';
import { WebdavServer } from "./webdav-server.js";
import * as fs from 'node:fs';
import mime from 'mime-types';

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
    const folderPath = path.dirname(filePath);
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
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
 * 삭제 후 삭제 한 파일 및 폴더 전체 경로 배열 반환
 * @param path 
 * @returns 
 */
export function rmDirectory(path: string) {
    const paths: string[] = [];
    const subPaths = fs.readdirSync(path).map(e => joinPath(path, e));
    for (const subPath of subPaths) {
        const fileStat = fs.statSync(subPath);
        if (fileStat.isDirectory()) {
            const removedPaths = rmDirectory(subPath);
            paths.push(...removedPaths);
        }
        else {
            fs.rmSync(subPath);
            paths.push(subPath);
        }
    }
    fs.rmdirSync(path);
    paths.push(path);
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
export function getEtag(fileStat: fs.Stats){
    return `${fileStat.ino}-${fileStat.ctimeMs}-${fileStat.mtimeMs}`;
}