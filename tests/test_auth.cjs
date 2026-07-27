const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  COMPANY_DOMAIN,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  isAllowedCompanyEmail,
  isStrongPassword,
  passwordIssueMessage
} = require('../public/auth.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const config = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'config.toml'), 'utf8');

assert.equal(COMPANY_DOMAIN, '7cantos.com');
assert.equal(MIN_PASSWORD_LENGTH, 12);
assert.equal(normalizeEmail('  FELIPE@7CANTOS.COM '), 'felipe@7cantos.com');
assert.equal(isAllowedCompanyEmail('felipe@7cantos.com'), true);
assert.equal(isAllowedCompanyEmail('felipe@sub.7cantos.com'), false);
assert.equal(isAllowedCompanyEmail('felipe@7cantos.com.br'), false);
assert.equal(isAllowedCompanyEmail('felipe@gmail.com'), false);
assert.equal(isStrongPassword('Cantos!2026Segura'), true);
assert.equal(isStrongPassword('senhafraca'), false);
assert.match(passwordIssueMessage('senhafraca'), /12 caracteres/);
assert.match(passwordIssueMessage('senhafraca'), /maiúscula/);
assert.match(html, /id="recovery-form"/);
assert.match(html, /id="new-password-form"/);
assert.match(html, /src="\.\/auth\.js"/);
assert.doesNotMatch(html, /id="magic-link-button"/);
assert.match(app, /resetPasswordForEmail/);
assert.match(app, /event === 'PASSWORD_RECOVERY'/);
assert.match(app, /updateUser\(\{password\}\)/);
assert.match(config, /enable_signup = false/);
assert.match(config, /minimum_password_length = 12/);
assert.match(config, /password_requirements = "lower_upper_letters_digits_symbols"/);

console.log('auth: ok');
