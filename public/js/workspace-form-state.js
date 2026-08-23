(function (global) {
  'use strict';

  function create(options) {
    var root = document.querySelector(options.root);
    var saves = Array.prototype.slice.call(document.querySelectorAll(options.save));
    if (!root || !saves.length || document.getElementById('northstarStickySaveBar')) return null;
    var dirty = false;
    var bar = document.createElement('div');
    bar.id = 'northstarStickySaveBar';
    bar.className = 'northstar-sticky-save';
    bar.hidden = true;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    var message = document.createElement('span');
    message.textContent = 'Unsaved changes';
    var action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn btn-primary btn-sm';
    action.textContent = 'Save Changes';
    bar.append(message, action);
    document.body.appendChild(bar);

    function setDirty(next) {
      dirty = Boolean(next);
      bar.hidden = !dirty;
      document.documentElement.toggleAttribute('data-northstar-unsaved', dirty);
    }

    function activeSave() {
      var sectionSave = saves.find(function (candidate) {
        var section = candidate.closest('.bp-section');
        return section && section.classList.contains('active') && !candidate.hidden;
      });
      if (sectionSave) return sectionSave;
      return saves.find(function (candidate) {
        return !candidate.closest('.bp-section') && !candidate.hidden;
      }) || saves[0];
    }

    root.addEventListener('input', function (event) {
      if (event.target.matches('input,textarea,select')) setDirty(true);
    });
    root.addEventListener('change', function (event) {
      if (event.target.matches('input,textarea,select')) setDirty(true);
    });
    action.addEventListener('click', function () {
      var save = activeSave();
      if (save.hidden || save.disabled) {
        save.scrollIntoView({ behavior: 'smooth', block: 'center' });
        save.focus();
        return;
      }
      save.click();
    });
    global.addEventListener('northstar:form-saved', function () { setDirty(false); });
    global.addEventListener('beforeunload', function (event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
    return Object.freeze({ clear: function () { setDirty(false); }, isDirty: function () { return dirty; } });
  }

  global.NorthStarFormState = Object.freeze({ create: create });
})(window);
