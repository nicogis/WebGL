define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function message(...args) {
        const message = Array.prototype.join.call(args, " ");
        const viewLog = document.getElementById("viewLog");
        viewLog.textContent = message;
    }
    exports.message = message;
    ;
    let timeoutHandle = 0;
    function timeout(...args) {
        message(...args);
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
        timeoutHandle = setTimeout(() => {
            timeoutHandle = 0;
            message("");
        }, 2000);
    }
    exports.timeout = timeout;
});
//# sourceMappingURL=log.js.map