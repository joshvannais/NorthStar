(function (global) {
  'use strict';

  function create(options) {
    var root = document.querySelector(options.root);
    var saves = Array.prototype.slice.call(document.querySelectorAll(options.save));
    if (!root || !saves.length || document.getElementById('northstarStickySaveBar')) return null;
    var dirty = false;
    var conflicted = false;
    var roleSource = options.role ? document.querySelector(options.role) : null;
    var reloads = options.reload
      ? Array.prototype.slice.call(document.querySelectorAll(options.reload)) : [];
    var bar = document.createElement('div');
    bar.id = 'northstarStickySaveBar';
    bar.className = 'northstar-sticky-save';
    bar.hidden = true;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    var copy = document.createElement('span');
    copy.className = 'northstar-sticky-save-copy';
    var message = document.createElement('strong');
    message.textContent = 'Unsaved changes';
    var role = document.createElement('span');
    role.className = 'northstar-sticky-save-role';
    role.textContent = roleSource ? roleSource.textContent : 'Edit access resolved by this page';
    copy.append(message, role);
    var actions = document.createElement('span');
    actions.className = 'northstar-sticky-save-actions';
    var reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'btn btn-secondary btn-sm';
    reload.textContent = 'Reload';
    reload.hidden = true;
    var action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn btn-primary btn-sm';
    action.textContent = 'Save Changes';
    actions.append(reload, action);
    bar.append(copy, actions);
    document.body.appendChild(bar);

    function setDirty(next) {
      dirty = Boolean(next);
      bar.hidden = !dirty;
      if (roleSource) role.textContent = roleSource.textContent;
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
    reload.addEventListener('click', function () {
      var target = reloads.find(function(candidate) { return !candidate.hidden && !candidate.disabled; });
      if (target) target.click();
      else global.location.reload();
    });
    global.addEventListener('northstar:form-saved', function () {
      conflicted = false;
      reload.hidden = true;
      action.hidden = false;
      message.textContent = 'Unsaved changes';
      setDirty(false);
    });
    global.addEventListener('northstar:form-conflict', function () {
      conflicted = true;
      message.textContent = 'Conflict detected — reload before saving';
      reload.hidden = false;
      action.hidden = true;
      setDirty(true);
    });
    global.addEventListener('beforeunload', function (event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
    return Object.freeze({
      clear: function () {
        conflicted = false;
        reload.hidden = true;
        action.hidden = false;
        message.textContent = 'Unsaved changes';
        setDirty(false);
      },
      isDirty: function () { return dirty; },
      isConflicted: function () { return conflicted; },
    });
  }

  global.NorthStarFormState = Object.freeze({ create: create });
})(window);
