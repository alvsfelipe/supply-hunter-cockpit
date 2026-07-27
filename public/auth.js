(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SupplyHunterAuth = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COMPANY_DOMAIN = '7cantos.com';
  const MIN_PASSWORD_LENGTH = 12;
  const SYMBOL = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/;

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isAllowedCompanyEmail(value) {
    const email = normalizeEmail(value);
    return email.endsWith(`@${COMPANY_DOMAIN}`) && email.length > COMPANY_DOMAIN.length + 1;
  }

  function passwordIssues(value) {
    const password = String(value || '');
    const issues = [];
    if (password.length < MIN_PASSWORD_LENGTH) issues.push(`pelo menos ${MIN_PASSWORD_LENGTH} caracteres`);
    if (!/[a-z]/.test(password)) issues.push('uma letra minúscula');
    if (!/[A-Z]/.test(password)) issues.push('uma letra maiúscula');
    if (!/\d/.test(password)) issues.push('um número');
    if (!SYMBOL.test(password)) issues.push('um símbolo');
    if (/\s/.test(password)) issues.push('nenhum espaço');
    return issues;
  }

  function isStrongPassword(value) {
    return passwordIssues(value).length === 0;
  }

  function passwordIssueMessage(value) {
    const issues = passwordIssues(value);
    return issues.length ? `A senha precisa ter ${issues.join(', ')}.` : '';
  }

  return {
    COMPANY_DOMAIN,
    MIN_PASSWORD_LENGTH,
    normalizeEmail,
    isAllowedCompanyEmail,
    passwordIssues,
    isStrongPassword,
    passwordIssueMessage
  };
});
