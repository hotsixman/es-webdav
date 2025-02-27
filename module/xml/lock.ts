import { DOMParser } from "xmldom";

/**
 * @todo owner 추가
 */
export function createLockXML(lockToken: string, timeout?: number | null): string {
    const XML = new DOMParser().parseFromString('<D:prop xmlns:D="DAV:"></D:prop>');

    const DProp = XML.children[0];

    const DLockdiscovery = XML.createElement('D:lockdiscovery');
    DProp.appendChild(DLockdiscovery);

    const DActivelock = XML.createElement('D:activelock');
    DLockdiscovery.appendChild(DActivelock);

    const DLockscope = XML.createElement('D:lockscope');
    DLockscope.innerHTML = '<D:exclusive/>';
    DActivelock.appendChild(DLockscope);

    const DLocktype = XML.createElement('D:locktype');
    DLocktype.innerHTML = '<D:write/>';
    DActivelock.appendChild(DLocktype);

    /*
    D:owner 추가
    */
    
    if(timeout){
        const DTimeout = XML.createElement('D:timeout');
        DTimeout.innerText = `Second-${timeout}`;
        DActivelock.appendChild(DTimeout);
    }

    const DLocktoken = XML.createElement('D:locktoken');
    {
        const DHref = XML.createElement('D:href');
        DHref.innerText = lockToken;
        DLocktoken.appendChild(DHref);
    }
    DActivelock.appendChild(DLocktoken);

    return '<?xml version="1.0" encoding="UTF-8"?>' + new XMLSerializer().serializeToString(XML);
}