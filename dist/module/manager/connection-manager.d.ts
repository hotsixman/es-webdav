import { Http2ServerRequest } from "node:http2";
export declare class ConnectionManager {
    static anonymous: symbol;
    readonly connectionMap: Map<string | Symbol, number>;
    readonly maxConnection: number;
    constructor(maxConnection: number);
    createConnection(req: Http2ServerRequest): boolean;
    destroyConnection(req: Http2ServerRequest): void;
}
//# sourceMappingURL=connection-manager.d.ts.map