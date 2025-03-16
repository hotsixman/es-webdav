import { Http2ServerRequest } from "node:http2";
import { getAuth } from "../func.js";

export class ConnectionManager{
    static anonymous = Symbol('anonymous');

    readonly connectionMap = new Map<string | Symbol, number>();
    readonly maxConnection: number;

    constructor(maxConnection: number){
        this.maxConnection = maxConnection;
    }

    createConnection(req: Http2ServerRequest): boolean {
        const auth = getAuth(req);
        if(!auth){
            var user: string | Symbol = ConnectionManager.anonymous;
        }
        else{
            var user: string | Symbol = auth[0];
        }

        if(this.connectionMap.has(user)){
            const connection = this.connectionMap.get(user) as number;
            if(connection >= this.maxConnection){
                return false;
            }
            else{
                this.connectionMap.set(user, connection + 1);
                return true;
            }
        }
        else{
            this.connectionMap.set(user, 1);
            return true;
        }
    }

    destroyConnection(req: Http2ServerRequest) {
        const auth = getAuth(req);
        if(!auth){
            var user: string | Symbol = ConnectionManager.anonymous;
        }
        else{
            var user: string | Symbol = auth[0];
        }

        const connection = this.connectionMap.get(user);
        if(typeof(connection) === "number"){
            this.connectionMap.set(user, Math.min(0, connection - 1));
        }
        else{
            this.connectionMap.set(user, 0);
        }
    }
}