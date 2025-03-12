export class ExpectedError extends Error {
    code;
    constructor(code, msg) {
        super(msg);
        this.code = code;
    }
}
//# sourceMappingURL=expected-error.js.map