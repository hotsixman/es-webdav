import { getAuth } from "../func.js";
export class ConnectionManager {
    static anonymous = Symbol('anonymous');
    connectionMap = new Map();
    maxConnection;
    constructor(maxConnection) {
        this.maxConnection = maxConnection;
    }
    createConnection(req) {
        const auth = getAuth(req);
        if (!auth) {
            var user = ConnectionManager.anonymous;
        }
        else {
            var user = auth[0];
        }
        if (this.connectionMap.has(user)) {
            const connection = this.connectionMap.get(user);
            if (connection >= this.maxConnection) {
                return false;
            }
            else {
                this.connectionMap.set(user, connection + 1);
                return true;
            }
        }
        else {
            this.connectionMap.set(user, 1);
            return true;
        }
    }
    destroyConnection(req) {
        const auth = getAuth(req);
        if (!auth) {
            var user = ConnectionManager.anonymous;
        }
        else {
            var user = auth[0];
        }
        const connection = this.connectionMap.get(user);
        if (typeof (connection) === "number") {
            this.connectionMap.set(user, Math.min(0, connection - 1));
        }
        else {
            this.connectionMap.set(user, 0);
        }
    }
}
//# sourceMappingURL=connection-manager.js.map