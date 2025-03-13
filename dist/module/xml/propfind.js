import * as fs from "node:fs";
import * as path from "node:path";
import { DOMParser, XMLSerializer } from "xmldom";
import * as mime from 'mime-types';
import { encodePath, getEtag, joinPath } from "../func.js";
import { createLockXML } from "./lock.js";
export function createPropfindXML({ server, servicePath, depth }) {
    depth = depth ?? 0;
    const stat = fs.statSync(server.getSourcePath(servicePath));
    const xml = createPropfindXMLBase();
    const DMultistatus = xml.childNodes[0];
    if (stat.isDirectory()) {
        const DResponseArr = createDResponsesInDirectory({ server, servicePath, depth });
        DResponseArr.forEach(DResponse => {
            DMultistatus.appendChild(DResponse);
        });
        if (servicePath === server.option.davRootPath && server.option.virtualDirectory) {
            Object.entries(server.option.virtualDirectory).forEach(([virtualPath, realPath]) => {
                if (!fs.existsSync(realPath)) {
                    return;
                }
                const DResponse = createDResponse({
                    server,
                    servicePath: joinPath(server.option.davRootPath, virtualPath)
                });
                DMultistatus.appendChild(DResponse);
            });
        }
    }
    else {
        const DResponse = createDResponse({ server, servicePath });
        DMultistatus.appendChild(DResponse);
    }
    return '<?xml version="1.0" encoding="utf-8" ?>' + new XMLSerializer().serializeToString(xml);
}
function createDResponsesInDirectory({ server, servicePath, depth }) {
    var files = fs.readdirSync(server.getSourcePath(servicePath));
    const DResponseArr = [];
    DResponseArr.push(createDResponse({
        server,
        servicePath
    }));
    if (depth === 1) {
        files.map((file) => {
            try {
                return createDResponse({
                    server,
                    servicePath: joinPath(servicePath, file)
                });
            }
            catch {
                const DResponseBase = createDResponseBase();
                const DResponse = DResponseBase.createElement('D:response');
                const DHref = DResponseBase.createElement('D:href');
                DHref.textContent = encodePath(joinPath(servicePath, file));
                const DPropstat = DResponseBase.createElement('D:propstat');
                const DStatus = DResponseBase.createElement('D:status');
                DStatus.textContent = 'HTTP/1.1 404 Not Found';
                DResponse.appendChild(DHref);
                DResponse.appendChild(DPropstat);
                DPropstat.appendChild(DStatus);
                return DResponse;
            }
        }).forEach(e => DResponseArr.push(e));
    }
    return DResponseArr;
}
function createDResponse({ server, servicePath }) {
    let fileStat = fs.statSync(server.getSourcePath(servicePath));
    const DResponseBase = createDResponseBase();
    const DResponse = DResponseBase.createElement('D:response');
    const DHref = DResponseBase.createElement('D:href');
    DHref.textContent = encodePath(servicePath);
    DResponse.appendChild(DHref);
    const DPropstat = DResponseBase.createElement('D:propstat');
    DResponse.appendChild(DPropstat);
    const mimeType = mime.lookup(path.basename(servicePath));
    const property = {
        creationdate: fileStat.ctime,
        displayname: path.basename(servicePath),
        getcontentlength: fileStat.size,
        getcontenttype: mimeType || undefined,
        getetag: getEtag(fileStat),
        getlastmodified: fileStat.mtime,
        resourcetype: fileStat.isDirectory() ? 'collection' : undefined
    };
    const DProp = createDPropXML({ property, DResponseBase, server, servicePath });
    DPropstat.appendChild(DProp);
    const DStatus = DResponseBase.createElement('D:status');
    DStatus.textContent = 'HTTP/1.1 200 OK';
    DPropstat.appendChild(DStatus);
    return DResponse;
}
function createDPropXML({ property, DResponseBase, server, servicePath }) {
    const DProp = DResponseBase.createElement('D:prop');
    {
        const DDisplayname = DResponseBase.createElement('D:displayname');
        DDisplayname.textContent = property.displayname;
        DProp.appendChild(DDisplayname);
    }
    {
        const DResourcetype = DResponseBase.createElement('D:resourcetype');
        if (property.resourcetype === "collection") {
            const DCollection = DResponseBase.createElement('D:collection');
            DResourcetype.appendChild(DCollection);
        }
        DProp.appendChild(DResourcetype);
    }
    {
        const DCreationdate = DResponseBase.createElement('D:creationdate');
        DCreationdate.textContent = property.creationdate.toISOString();
        DProp.appendChild(DCreationdate);
    }
    {
        const DGetlastmodified = DResponseBase.createElement('D:getlastmodified');
        DGetlastmodified.textContent = property.getlastmodified.toUTCString();
        DProp.appendChild(DGetlastmodified);
    }
    {
        const DGetetag = DResponseBase.createElement('D:getetag');
        DGetetag.textContent = `"${property.getetag}"`;
        DProp.appendChild(DGetetag);
    }
    {
        const DGetcontenttype = DResponseBase.createElement('D:getcontenttype');
        if (property.getcontenttype) {
            DGetcontenttype.textContent = property.getcontenttype;
        }
        else {
            DGetcontenttype.textContent = "text/plain";
        }
        DProp.appendChild(DGetcontenttype);
    }
    {
        const DGetcontentlength = DResponseBase.createElement('D:getcontentlength');
        DGetcontentlength.textContent = property.getcontentlength.toString();
        DProp.appendChild(DGetcontentlength);
    }
    if (server.lockManager.isLocked(servicePath)) {
        const lockToken = server.lockManager.getLockToken(servicePath);
        const timeout = server.lockManager.getTimeout(servicePath);
        const DLockdiscovery = new DOMParser().parseFromString(createLockXML(lockToken, timeout)).getElementsByTagName('D:lockdiscovery')[0];
        if (DLockdiscovery) {
            DProp.appendChild(DLockdiscovery);
        }
    }
    {
        const DSupportedlock = DResponseBase.createElement('D:supportedlock');
        DSupportedlock.innerHTML = '<D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>';
        DProp.appendChild(DSupportedlock);
    }
    return DProp;
}
function createPropfindXMLBase() {
    return new DOMParser().parseFromString('<D:multistatus xmlns:D="DAV:"></D:multistatus>', 'text/xml');
}
function createDResponseBase() {
    return new DOMParser().parseFromString('<D:response></D:response>', 'text/xml');
}
//# sourceMappingURL=propfind.js.map