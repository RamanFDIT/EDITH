const fs = require('fs');
const path = require('path');
const logFile = path.join(require('os').homedir(), 'electron-test.log');

try {
  const e = require('electron');
  const info = {
    type: typeof e,
    isString: typeof e === 'string',
    value: typeof e === 'string' ? e : Object.keys(e).join(', '),
    appType: typeof e === 'object' ? typeof e.app : 'N/A',
    bwType: typeof e === 'object' ? typeof e.BrowserWindow : 'N/A',
  };
  fs.writeFileSync(logFile, JSON.stringify(info, null, 2));
} catch (err) {
  fs.writeFileSync(logFile, 'ERROR: ' + err.message);
}
process.exit(0);
