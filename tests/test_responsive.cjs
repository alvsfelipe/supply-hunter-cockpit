const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

assert.match(html, /@media \(max-width:860px\)/);
assert.match(html, /@media \(max-width:600px\)/);
assert.match(html, /@media \(max-width:380px\)/);
assert.match(html, /min-height:100dvh/);
assert.match(html, /env\(safe-area-inset-bottom\)/);
assert.match(html, /scroll-snap-type:x mandatory/);
assert.match(html, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,300px\),1fr\)\)/);
assert.match(html, /nav button\{flex:0 0 auto;width:auto;min-height:54px;justify-content:center/);
assert.match(html, /\.row\{grid-template-columns:92px minmax\(0,1fr\)/);
assert.match(html, /\.row\{grid-template-columns:1fr\}\s+\.prio\{display:flex;align-items:baseline/);
assert.match(html, /<nav aria-label="Navegação principal">/);
assert.match(app, /class="script-controls"/);
assert.match(app, /button\.scrollIntoView/);
console.log('responsive: ok');
