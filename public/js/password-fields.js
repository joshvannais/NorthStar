(function (global) {
  'use strict';

  var MISMATCH_MESSAGE = 'Passwords do not match.';

  function controlledInput(button) {
    var id = button.getAttribute('aria-controls');
    return id ? global.document.getElementById(id) : null;
  }

  function setVisibility(button, visible, restoreFocus) {
    var input = controlledInput(button);
    if (!input) return;
    var selectionStart = input.selectionStart;
    var selectionEnd = input.selectionEnd;
    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    button.textContent = visible ? 'Hide' : 'Show';
    if (!restoreFocus) return;
    input.focus({ preventScroll: true });
    if (selectionStart !== null && selectionEnd !== null) {
      try { input.setSelectionRange(selectionStart, selectionEnd); } catch (_error) {}
    }
  }

  function confirmationFields(form) {
    var confirmation = form && form.querySelector('[data-password-confirmation-for]');
    if (!confirmation) return null;
    var password = global.document.getElementById(confirmation.getAttribute('data-password-confirmation-for'));
    var errorId = confirmation.getAttribute('aria-errormessage');
    var error = errorId ? global.document.getElementById(errorId) : null;
    return password && error ? { password: password, confirmation: confirmation, error: error } : null;
  }

  function setConfirmationError(fields, mismatch) {
    fields.confirmation.setCustomValidity(mismatch ? MISMATCH_MESSAGE : '');
    fields.confirmation.setAttribute('aria-invalid', mismatch ? 'true' : 'false');
    fields.error.hidden = !mismatch;
    fields.error.textContent = mismatch ? MISMATCH_MESSAGE : '';
  }

  function validateConfirmation(form) {
    var fields = confirmationFields(form);
    if (!fields) return true;
    var mismatch = fields.password.value !== fields.confirmation.value;
    setConfirmationError(fields, mismatch);
    if (mismatch) fields.confirmation.focus({ preventScroll: true });
    return !mismatch;
  }

  function initialize(root) {
    var scope = root || global.document;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-password-toggle]'), function (button) {
      if (button.getAttribute('data-password-toggle-ready') === 'true') return;
      button.setAttribute('data-password-toggle-ready', 'true');
      setVisibility(button, false, false);
      button.addEventListener('click', function () {
        setVisibility(button, button.getAttribute('aria-pressed') !== 'true', true);
      });
    });

    Array.prototype.forEach.call(scope.querySelectorAll('form'), function (form) {
      var fields = confirmationFields(form);
      if (!fields || form.getAttribute('data-password-confirmation-ready') === 'true') return;
      form.setAttribute('data-password-confirmation-ready', 'true');
      function refreshActiveError() {
        if (fields.confirmation.getAttribute('aria-invalid') === 'true') validateConfirmation(form);
      }
      fields.password.addEventListener('input', refreshActiveError);
      fields.confirmation.addEventListener('input', refreshActiveError);
      form.addEventListener('reset', function () {
        global.setTimeout(function () {
          setConfirmationError(fields, false);
          Array.prototype.forEach.call(form.querySelectorAll('[data-password-toggle]'), function (button) {
            setVisibility(button, false, false);
          });
        }, 0);
      });
    });
  }

  global.NorthStarPasswordFields = Object.freeze({
    initialize: initialize,
    validateConfirmation: validateConfirmation,
  });

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', function () { initialize(global.document); }, { once: true });
  } else {
    initialize(global.document);
  }
})(window);
