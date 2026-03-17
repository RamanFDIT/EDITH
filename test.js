const os = { homedir: () => 'C:\\Users\\Bob' };
const s = `
# UTC_ISO_TIMESTAMP: 123
\n\`${os.homedir().replace(/\\/g, '/')}\`
`;
console.log("OK");
