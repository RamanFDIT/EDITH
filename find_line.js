import fs from 'fs';
const lines = fs.readFileSync('systemPrompt.js', 'utf8').split('\n');
for (let i = 46; i < lines.length; i++) {
  const currentText = lines.slice(46, i).join('\n') + '\n`); \n}';
  try {
    new Function('getCurrentTimeContext', 'SystemMessage', 'os', currentText);
  } catch (e) {
    if (e.message.includes('missing ) after argument list') || e.message.includes('Unexpected EOF') || e.message.includes('SyntaxError')) {
       console.log("SYNTAX ERROR FOUND ON LINE:", i);
       console.log("TEXT: ", lines[i - 1]);
       break;
    }
  }
}
