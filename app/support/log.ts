export function message(...args: any[]) {
  const message = Array.prototype.join.call(args, " ");
  const viewLog = document.getElementById("viewLog");

  viewLog.textContent = message;
};

let timeoutHandle = 0;

export function timeout(...args: any[]) {
  message(...args);

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  timeoutHandle = setTimeout(() => {
    timeoutHandle = 0;
    message("");
  }, 2000);
}
