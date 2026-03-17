const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('systemPrompt.js', 'utf8');
try {
  new vm.Script(code);
  console.log('No syntax error found in vm.Script');
} catch (e) {
  console.log('SYNTAX ERROR:', e.message);
  console.log(e.stack);
}
