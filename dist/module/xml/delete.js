import { DOMParser, XMLSerializer } from "xmldom";
import { encodePath } from "../func.js";
export function createDeleteXML(deletedPaths) {
    const xml = new DOMParser().parseFromString('<D:multistatus xmlns:D="DAV:"></D:multistatus>', 'text/xml');
    const DMultistatus = xml.childNodes[0];
    for (const deletedPath of deletedPaths) {
        const DResponse = xml.createElement('D:response');
        const DHref = xml.createElement('D:href');
        DHref.textContent = encodePath(deletedPath);
        DResponse.appendChild(DHref);
        const DStatus = xml.createElement('D:status');
        DStatus.textContent = "HTTP/1.1 204 No Content";
        DResponse.appendChild(DStatus);
        DMultistatus.appendChild(DStatus);
    }
    return '<?xml version="1.0" encoding="UTF-8"?>' + new XMLSerializer().serializeToString(xml);
}
//# sourceMappingURL=delete.js.map