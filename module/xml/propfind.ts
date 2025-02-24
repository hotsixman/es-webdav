import * as fs from "node:fs";
import * as path from "node:path";
import { DOMParser, XMLSerializer } from "xmldom";
import * as mime from 'mime-types';
import { decodePath, encodePath, getEtag, joinPath } from "../func.js";
import { WebdavServer } from "../webdav-server.js";

export function createPropfindXML({ server, reqPath, depth }: PropfindArgs) {
    depth = depth ?? 0;
    const stat = fs.statSync(server.getSourcePath(reqPath));
    const xml = createPropfindXMLBase();
    const DMultistatus = xml.childNodes[0];
    if (stat.isDirectory()) {
        const DResponseArr = createDResponsesInDirectory({ server, reqPath, depth });
        DResponseArr.forEach(DResponse => {
            DMultistatus.appendChild(DResponse);
        })
        if (reqPath === "/" && server.option.virtualDirectory) {
            Object.keys(server.option.virtualDirectory).forEach((virtualPath) => {
                const DResponse = createDResponse({
                    server,
                    reqPath: decodePath(virtualPath)
                });
                DMultistatus.appendChild(DResponse)
            })
        }
    }
    else {
        const DResponse = createDResponse({ server, reqPath });
        DMultistatus.appendChild(DResponse);
    }

    return '<?xml version="1.0" encoding="utf-8" ?>' + new XMLSerializer().serializeToString(xml);
}

function createDResponsesInDirectory({ server, reqPath, depth }: PropfindArgs) {
    var files = fs.readdirSync(server.getSourcePath(reqPath));

    const DResponseArr = [];

    DResponseArr.push(createDResponse({
        server,
        reqPath
    }));

    if (depth === 1) {
        files.map((file) => {
            try {
                return createDResponse({
                    server,
                    reqPath: joinPath(reqPath, file)
                })
            }
            catch {
                const DResponseBase = createDResponseBase();
                const DResponse = DResponseBase.createElement('D:response');

                const DHref = DResponseBase.createElement('D:href');
                DHref.textContent = encodePath(joinPath(reqPath, file));

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

function createDResponse({ server, reqPath }: Omit<PropfindArgs, "depth">) {
    let fileStat = fs.statSync(server.getSourcePath(reqPath));
    const DResponseBase = createDResponseBase();
    const DResponse = DResponseBase.createElement('D:response');

    const DHref = DResponseBase.createElement('D:href');
    DHref.textContent = encodePath(reqPath);
    DResponse.appendChild(DHref);

    const DPropstat = DResponseBase.createElement('D:propstat');
    DResponse.appendChild(DPropstat);

    const mimeType = mime.lookup(path.basename(reqPath));
    const property: PropfindProperty = {
        creationdate: fileStat.ctime,
        displayname: fileStat.isFile() ? path.basename(reqPath) : (reqPath.split('/').at(-2) ?? '/'),
        getcontentlength: fileStat.size,
        getcontenttype: mimeType || undefined,
        getetag: getEtag(fileStat),
        getlastmodified: fileStat.mtime,
        resourcetype: fileStat.isDirectory() ? 'collection' : undefined
    }
    const DProp = createDPropXML({ property, DResponseBase });
    DPropstat.appendChild(DProp);

    const DStatus = DResponseBase.createElement('D:status');
    DStatus.textContent = 'HTTP/1.1 200 OK';
    DPropstat.appendChild(DStatus);

    return DResponse;
}

/**
 * `PropfindProperty`가 수정되면 해당 프로퍼티 추가
 * @todo `lockdiscovery`, `supportedlock` 추가
 * @param param0 
 * @returns 
 */
function createDPropXML({ property, DResponseBase }: { property: PropfindProperty, DResponseBase: Document }) {
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
        DProp.appendChild(DGetcontenttype);
    }

    {
        const DGetcontentlength = DResponseBase.createElement('D:getcontentlength');
        DGetcontentlength.textContent = property.getcontentlength.toString();
        DProp.appendChild(DGetcontentlength);
    }

    {
        DProp.appendChild(DResponseBase.createElement('D:lockdiscovery'));
        DProp.appendChild(DResponseBase.createElement('D:supportedlock'));
    }

    return DProp;
}

function createPropfindXMLBase() {
    return new DOMParser().parseFromString('<D:multistatus xmlns:D="DAV:"></D:multistatus>', 'text/xml');
}

function createDResponseBase() {
    return new DOMParser().parseFromString('<D:response></D:response>', 'text/xml');
}



interface PropfindArgs {
    reqPath: string;
    depth?: 0 | 1;
    server: WebdavServer;
}

/**
 * `D:Prop` 요소의 하위 요소에 사용할 속성
 * @todo lookdiscovery와 supportedlock 추가
 * @todo 
 * ACL 속성 추가
 * - owner
 * - group
 * - supported-privilege-set
 * - current-user-privilege-set
 * @todo 
 * Storage 관련 속성 추가 
 * - quota-available-bytes
 * - quota-used-bytes
 * @todo
 * 검색 및 색인 관련 속성 추가
 * - indexing
 * - searchable
 * @todo
 * MS 확장 속성추가
 * - iscolection
 * - isreadonly
 * - ishidden
 * - filetype
 * 
 */
interface PropfindProperty {
    displayname: string;
    resourcetype: 'collection' | undefined;
    creationdate: Date;
    getlastmodified: Date;
    getetag: string;
    getcontenttype: string | undefined; //mime
    getcontentlength: number; //bytes
}