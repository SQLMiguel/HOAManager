/* ── Shared form-validation helpers ─────────────────────────────────
   Include via <script src="js/validation.js"></script> BEFORE page JS.
   ─────────────────────────────────────────────────────────────────── */

const FormValidation = (() => {
  'use strict';

  // ── Email regex (RFC 5322 simplified) ──────────────────────────
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // ── Phone: US 10-digit ─────────────────────────────────────────
  const PHONE_DIGITS = 10;

  /** Returns true if email looks valid */
  function isValidEmail(email) {
    return EMAIL_RE.test((email || '').trim());
  }

  /** Returns digits-only string from a phone value */
  function phoneDigits(val) {
    return (val || '').replace(/\D/g, '').slice(0, PHONE_DIGITS);
  }

  /** Format digits → (XXX) XXX-XXXX */
  function formatPhone(val) {
    const d = phoneDigits(val);
    if (d.length > 6) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
    if (d.length > 3) return `(${d.slice(0,3)}) ${d.slice(3)}`;
    if (d.length > 0) return `(${d}`;
    return '';
  }

  /** Returns true if the phone field is empty OR has exactly 10 digits */
  function isValidPhone(val) {
    const d = phoneDigits(val);
    return d.length === 0 || d.length === PHONE_DIGITS;
  }

  // ── Auto-wire helpers ──────────────────────────────────────────

  /** Attach live phone mask to an input element */
  function maskPhone(input) {
    if (!input) return;
    input.addEventListener('input', function () {
      const pos = this.selectionStart;
      const before = this.value.length;
      this.value = formatPhone(this.value);
      // keep cursor in a reasonable spot after reformatting
      const diff = this.value.length - before;
      this.setSelectionRange(pos + diff, pos + diff);
    });
    input.setAttribute('placeholder', '(555) 123-4567');
    input.setAttribute('maxlength', '14');
  }

  /** Attach blur-time validation styling to an email input */
  function validateEmailInput(input) {
    if (!input) return;
    input.addEventListener('blur', function () {
      const v = this.value.trim();
      if (v && !isValidEmail(v)) {
        this.style.borderColor = '#e74c3c';
        showInlineError(this, 'Please enter a valid email address.');
      } else {
        this.style.borderColor = '';
        clearInlineError(this);
      }
    });
    input.addEventListener('input', function () {
      if (this.value.trim() && isValidEmail(this.value.trim())) {
        this.style.borderColor = '';
        clearInlineError(this);
      }
    });
  }

  /** Attach blur-time validation styling to a phone input */
  function validatePhoneInput(input) {
    if (!input) return;
    input.addEventListener('blur', function () {
      const v = this.value.trim();
      if (v && !isValidPhone(v)) {
        this.style.borderColor = '#e74c3c';
        showInlineError(this, 'Phone number must be 10 digits.');
      } else {
        this.style.borderColor = '';
        clearInlineError(this);
      }
    });
    input.addEventListener('input', function () {
      if (isValidPhone(this.value)) {
        this.style.borderColor = '';
        clearInlineError(this);
      }
    });
  }

  // ── Inline error message helpers ───────────────────────────────
  function showInlineError(input, msg) {
    clearInlineError(input);
    const el = document.createElement('span');
    el.className = 'field-validation-error';
    el.textContent = msg;
    el.style.cssText = 'color:#e74c3c;font-size:0.78rem;display:block;margin-top:4px;';
    input.parentNode.appendChild(el);
  }

  function clearInlineError(input) {
    const existing = input.parentNode.querySelector('.field-validation-error');
    if (existing) existing.remove();
  }

  // ── Auto-init: find all tel and email inputs on page ───────────
  function autoInit() {
    document.querySelectorAll('input[type="tel"]').forEach(el => {
      maskPhone(el);
      validatePhoneInput(el);
    });
    document.querySelectorAll('input[type="email"]').forEach(el => {
      validateEmailInput(el);
    });
  }

  // Run on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  // Public API
  return { isValidEmail, isValidPhone, phoneDigits, formatPhone, maskPhone, validateEmailInput, validatePhoneInput };
})();
