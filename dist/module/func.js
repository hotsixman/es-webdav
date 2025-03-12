import * as path from 'path';
import * as fs from 'node:fs';
export function setHeader(res, header) {
    Object.entries(header).forEach(([name, value]) => {
        if (typeof (value) === "undefined")
            return;
        res.setHeader(name, value);
    });
}
export function joinPath(...args) {
    return slash(path.join(...args));
}
export function resolvePath(...args) {
    return slash(path.resolve(...args));
}
export function getParentPath(pathname) {
    let dirname = path.dirname(pathname);
    if (dirname.endsWith('/')) {
        dirname = dirname.slice(0, -1);
    }
    return slash(dirname);
}
export function slash(path) {
    return path.replace(/\\/g, '/');
}
export async function writeFile(req, filePath) {
    const writeStream = fs.createWriteStream(filePath);
    try {
        await new Promise((resolve, reject) => {
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
export function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
}
export function decodePath(path) {
    return path.split('/').map(decodeURIComponent).join('/');
}
export function pipe(value, funcArr) {
    for (const func of funcArr) {
        value = func(value);
    }
    ;
    return value;
}
export async function asyncPipe(value, funcArr) {
    for (const func of funcArr) {
        value = await func(value);
    }
    ;
    return value;
}
export function rmDirectory(reqPath, server) {
    const paths = [];
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
export function escapeRegexp(string) {
    if (typeof string !== 'string') {
        throw new TypeError('Expected a string');
    }
    return string
        .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
        .replace(/-/g, '\\x2d');
}
export function getEtag(fileStat) {
    return `${fileStat.ino}-${fileStat.ctimeMs}-${fileStat.mtimeMs}`;
}
export function isChildPath(parentPath, childPath) {
    if (!parentPath.endsWith('/')) {
        parentPath += "/";
    }
    if (!childPath.endsWith('/')) {
        childPath += '/';
    }
    return childPath.startsWith(parentPath);
}
export function isSamePath(path1, path2) {
    if (!path1.endsWith('/')) {
        path1 += "/";
    }
    if (!path2.endsWith('/')) {
        path2 += '/';
    }
    return path2.startsWith(path1);
}
export function getReqPath(req) {
    let reqPath = decodePath(req.url);
    if (reqPath !== "/" && reqPath.endsWith('/')) {
        reqPath = reqPath.slice(0, -1);
    }
    return reqPath;
}
export function getLockToken(req) {
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
export function getTimeout(req) {
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
export function getDepth(req) {
    const depth = req.headers.depth;
    if (depth === "infinity") {
        return Infinity;
    }
    if (!depth) {
        return 0;
    }
    return Number(depth) || 0;
}
export function lockPath(servicePath, server, depth, timeout = null, lockToken) {
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
    if (depth === Infinity) {
        if (fs.statSync(sourcePath).isDirectory()) {
            const entries = fs.readdirSync(sourcePath);
            if (servicePath === "/" && server.option.virtualDirectory) {
                entries.push(...Object.keys(server.option.virtualDirectory));
            }
            entries.forEach((entry) => {
                const entryServicePath = joinPath(servicePath, entry);
                lockPath(entryServicePath, server, depth, timeout, lockToken);
            });
        }
    }
    return lockToken;
}
export function getAuth(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return null;
    }
    if (typeof (authHeader) !== "string") {
        return null;
    }
    const [authType, credentials] = authHeader.split(" ").map(e => e.trim());
    switch (authType) {
        case ("Basic"): {
            const decodedCredentials = atob(credentials);
            const [user, password] = decodedCredentials.split(":");
            return [user, password];
        }
    }
    return null;
}
//# sourceMappingURL=func.js.map