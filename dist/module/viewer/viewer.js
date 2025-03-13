import * as fs from "node:fs";
import { ExpectedError } from "../expected-error.js";
import { getReqParam, getReqPath, joinPath, setHeader } from "../func.js";
export const useViewer = async (req, res, server) => {
    if (server.option.davRootPath === '/viewer') {
        throw new ExpectedError('davRootPath cannot be "/viewer? using "useViewer" middleware');
    }
    const reqPath = getReqPath(req);
    if (!reqPath.startsWith('/viewer'))
        return;
    const reqParam = getReqParam(req);
    const pathParam = reqParam.get('path');
    if (!pathParam || !pathParam.startsWith(server.option.davRootPath)) {
        res.statusCode = 302;
        setHeader(res, {
            'location': `/viewer?path=${encodeURIComponent(server.option.davRootPath)}`
        });
        return res.end();
    }
    const htmlPath = joinPath(import.meta.dirname, 'viewer.html');
    const htmlStat = fs.statSync(htmlPath);
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const contentType = 'text/html';
    res.statusCode = 200;
    setHeader(res, {
        'content-type': contentType || undefined,
        'content-length': htmlStat.size,
        'accept-ranges': 'bytes',
    });
    res.write(html);
    return res.end();
};
//# sourceMappingURL=viewer.js.map