const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.match(html, /--brand:#6EA5FF/);
assert.match(html, /--brick:#DD6435/);
assert.match(html, /Plus\+Jakarta\+Sans/);
assert.equal((html.match(/class="brand-logo"/g) || []).length, 2);
assert.equal((html.match(/src="data:image\/png;base64,/g) || []).length, 2);
assert.doesNotMatch(html, /<div class="brand"><b>Supply Hunter<\/b>/);
console.log('brand: ok');
