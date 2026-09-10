(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;else root.NorthStarProfileFields = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var own = function (o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  };
  var object = function (v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  };
  var copy = function (v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  };
  var types = {
    fixed: 'Fixed charge',
    perUnit: 'Price per unit',
    perUnitByValue: 'Price per unit by choice',
    perItemByValue: 'Price per listed item'
  };
  var categories = {
    labor: 'Labor',
    materials: 'Materials',
    equipment: 'Equipment',
    serviceCharge: 'Service charge'
  };
  var friendly = function (v) {
    return String(v).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.:-]+/g, ' ').replace(/^./, function (c) {
      return c.toUpperCase();
    });
  };
  var number = function (v, min, max) {
    return typeof v === 'number' && Number.isFinite(v) && v >= min && (max === undefined || v <= max);
  };
  var key = function (v) {
    return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(v);
  };
  function shape(kind, v) {
    if (v === undefined) return true;
    if (kind === 'polygon') return Array.isArray(v) && v.every(function (p) {
      return Array.isArray(p) && p.length === 2 && number(p[0], -90, 90) && number(p[1], -180, 180) || object(p) && Object.keys(p).every(function (k) {
        return ['latitude', 'longitude'].includes(k);
      }) && number(p.latitude, -90, 90) && number(p.longitude, -180, 180);
    });
    if (kind === 'material' || kind === 'equipment') return object(v) && Object.keys(v).every(function (k) {
      return k.trim() && number(v[k], 0);
    });
    if (!object(v) || Object.keys(v).some(function (k) {
      return !['requiredScope', 'allowedScopeValues', 'rangePercent', 'lineItems'].includes(k);
    })) return false;
    if (own(v, 'requiredScope') && (!Array.isArray(v.requiredScope) || !v.requiredScope.every(key))) return false;
    if (own(v, 'rangePercent') && !number(v.rangePercent, 0, 100)) return false;
    if (own(v, 'allowedScopeValues') && (!object(v.allowedScopeValues) || !Object.keys(v.allowedScopeValues).every(function (k) {
      return key(k) && Array.isArray(v.allowedScopeValues[k]) && v.allowedScopeValues[k].every(function (x) {
        return ['string', 'number', 'boolean'].includes(typeof x) && (typeof x !== 'number' || Number.isFinite(x));
      });
    }))) return false;
    if (!own(v, 'lineItems')) return Object.keys(v).length === 0;
    return Array.isArray(v.lineItems) && v.lineItems.every(function (r) {
      if (!object(r) || Object.keys(r).some(function (k) {
        return !['code', 'label', 'category', 'type', 'amount', 'quantityField', 'unitRate', 'selectorField', 'unitRates', 'collectionField', 'when'].includes(k);
      }) || !key(r.code) || typeof r.label !== 'string' || !own(types, r.type) || !own(categories, r.category)) return false;
      if (['amount', 'unitRate'].some(function (k) {
        return own(r, k) && !number(r[k], 0);
      })) return false;
      if (['quantityField', 'selectorField', 'collectionField'].some(function (k) {
        return own(r, k) && !key(r[k]);
      })) return false;
      if (own(r, 'unitRates') && (!object(r.unitRates) || !Object.keys(r.unitRates).every(function (k) {
        return k.trim() && k === k.toLowerCase() && number(r.unitRates[k], 0);
      }))) return false;
      if (own(r, 'when') && (!object(r.when) || Object.keys(r.when).some(function (k) {
        return !['field', 'equals'].includes(k);
      }) || !key(r.when.field) || !own(r.when, 'equals'))) return false;
      return true;
    });
  }
  function validate(kind, v) {
    if (kind === 'polygon' && Array.isArray(v) && v.length > 0 && v.length < 3) return 'Add at least three boundary points, or clear the boundary.';
    if (!shape(kind, v)) return kind === 'polygon' ? 'Enter a valid latitude and longitude for every boundary point.' : kind === 'material' || kind === 'equipment' ? 'Enter a valid reference and a nonnegative internal cost for every row.' : 'Review the charge settings and correct the highlighted values.';
    if (v === undefined) return '';
    if (kind === 'polygon' && v.length > 0 && v.length < 3) return 'Add at least three boundary points, or clear the boundary.';
    if (kind !== 'pricing') return '';
    if (!Object.keys(v).length) return '';
    if (!v.lineItems || !v.lineItems.length) return 'Add at least one charge, or choose no pricing.';
    if (v.requiredScope && new Set(v.requiredScope).size !== v.requiredScope.length) return 'Each required job detail must appear only once.';
    if (v.allowedScopeValues && Object.values(v.allowedScopeValues).some(function (a) {
      return !a.length;
    })) return 'Add at least one allowed choice for each job detail.';
    var seen = new Set();
    for (var r of v.lineItems) {
      if (seen.has(r.code)) return 'Each charge must have a different saved reference.';
      seen.add(r.code);
      if (!r.label.trim()) return 'Give each charge a name.';
      if (r.type === 'fixed' && !own(r, 'amount')) return 'Enter the amount for each fixed charge.';
      if (['perUnit', 'perUnitByValue'].includes(r.type) && !r.quantityField) return 'Choose the quantity detail for each price per unit.';
      if (r.type === 'perUnit' && !own(r, 'unitRate')) return 'Enter the price per unit.';
      if (['perUnitByValue', 'perItemByValue'].includes(r.type) && (!r.selectorField || !r.unitRates || !Object.keys(r.unitRates).length)) return 'Choose a job detail and add its prices by choice.';
      if (r.type === 'perItemByValue' && !r.collectionField) return 'Choose the list of items to price.';
    }
    return '';
  }
  function splitMaterial(saved, services) {
    var matches = (services || []).map(function (s) {
      return String(s.id).trim().toLowerCase();
    }).filter(function (s) {
      return saved.startsWith(s + ':');
    }).sort(function (a, b) {
      return b.length - a.length;
    });
    var i = matches.length ? matches[0].length : saved.lastIndexOf(':');
    return {
      service: saved.slice(0, i),
      material: saved.slice(i + 1)
    };
  }
  var serial = 0;
  // The hidden carrier belongs to the existing save/concurrency/dirty-state flow.
  // Typed drafts live here; only this reader may hand them back to that flow.
  // Saved unknown shapes remain intact until an explicit replacement decision.
  function mount(carrier, kind, initial, options) {
    options = options || {};
    if (carrier._profileFields) {
      carrier._profileFields.load(initial, options);
      return carrier._profileFields;
    }
    var state = copy(initial),
      unresolved = !shape(kind, state),
      issue = '',
      pendingCost = null,
      fieldErrors = new Map();
    carrier.value = state === undefined ? '' : JSON.stringify(state);
    var host = document.createElement('fieldset');
    host.className = 'profile-structured';
    host.dataset.profileEditor = kind;
    var legend = document.createElement('legend');
    legend.textContent = options.label || {
      polygon: 'Service area boundary',
      material: 'Material costs',
      equipment: 'Equipment costs',
      pricing: 'Service pricing'
    }[kind];
    host.appendChild(legend);
    var content = document.createElement('div');
    host.appendChild(content);
    carrier.hidden = true;
    carrier.setAttribute('aria-hidden', 'true');
    carrier.tabIndex = -1;
    var oldLabel = carrier.parentElement.querySelector('label[for="' + carrier.id + '"]');
    if (oldLabel) oldLabel.hidden = true;
    carrier.insertAdjacentElement('afterend', host);
    var status = document.createElement('p');
    status.className = 'profile-structured-status';
    status.setAttribute('role', 'status');
    host.appendChild(status);
    function el(tag, text, parent) {
      var e = document.createElement(tag);
      if (text !== undefined) e.textContent = text;
      if (parent) parent.appendChild(e);
      return e;
    }
    function sync() {
      host.disabled = carrier.disabled || Boolean(options.canEdit && !options.canEdit());
    }
    new MutationObserver(sync).observe(carrier, {
      attributes: true,
      attributeFilter: ['disabled']
    });
    function emit() {
      carrier.value = fieldErrors.size || issue || pendingCost ? 'Unresolved form entry' : state === undefined ? '' : JSON.stringify(state);
      carrier.dataset.structuredInvalid = issue || fieldErrors.size || unresolved || pendingCost ? 'true' : 'false';
      carrier.dispatchEvent(new Event('input', {
        bubbles: true
      }));
      sync();
    }
    function changed() {
      status.textContent = issue;
      emit();
    }
    function button(text, fn, parent) {
      var b = el('button', text, parent || content);
      b.type = 'button';
      b.className = 'equipment-button';
      b.addEventListener('click', function () {
        if (host.disabled) return;
        if (fieldErrors.size) {
          status.textContent = 'Correct the highlighted entry before changing other settings.';
          return;
        }
        fn();
      });
      return b;
    }
    function input(label, value, fn, parent, type, min, max) {
      var wrap = el('label', undefined, parent);
      wrap.className = 'profile-structured-field';
      el('span', label, wrap);
      var c = el('input', undefined, wrap);
      c.type = type || 'text';
      c.value = value === undefined ? '' : String(value);
      c.id = 'profile-entry-' + ++serial;
      if (type === 'number') {
        c.step = 'any';
        if (min !== undefined) c.min = min;
        if (max !== undefined) c.max = max;
      }
      c.addEventListener('input', function () {
        if (host.disabled) return;
        issue = '';
        var next = c.value;
        if (type === 'number') {
          if (next.trim() === '' || !Number.isFinite(Number(next)) || !c.validity.valid) {
            fieldErrors.set(c, 'Enter a valid ' + label.toLowerCase() + '.');
            c.setAttribute('aria-invalid', 'true');
            status.textContent = fieldErrors.get(c);
            emit();
            return;
          }
          next = Number(next);
        }
        fieldErrors.delete(c);
        c.removeAttribute('aria-invalid');
        fn(next);
        if (issue) {
          fieldErrors.set(c, issue);
          c.setAttribute('aria-invalid', 'true');
        }
        changed();
      });
      return c;
    }
    function select(label, value, choices, fn, parent) {
      var wrap = el('label', undefined, parent);
      wrap.className = 'profile-structured-field';
      var caption = el('span', label, wrap);
      caption.id = 'profile-label-' + ++serial;
      var c = el('select', undefined, wrap);
      c.setAttribute('aria-labelledby', caption.id);
      Object.keys(choices).forEach(function (k) {
        var op = el('option', choices[k], c);
        op.value = k;
      });
      c.value = value;
      c.addEventListener('change', function () {
        if (host.disabled) return;
        if (fieldErrors.size && !fieldErrors.has(c)) {
          c.value = value;
          status.textContent = 'Correct the highlighted entry first.';
          return;
        }
        issue = '';
        fieldErrors.delete(c);
        fn(c.value);
        if (issue) fieldErrors.set(c, issue);
        changed();
      });
      return c;
    }
    function details(label, parent) {
      var d = el('details', undefined, parent);
      el('summary', label, d);
      return d;
    }
    function rerender() {
      function scope(node) { var row=node.closest('.profile-structured-charge'); return row ? row.dataset.ruleCode : ''; }
      function caption(node) { var span=node.querySelector('span'); return span ? span.textContent : node.textContent; }
      function disclosureKey(node) {
        var label=node.querySelector('summary').textContent, group=scope(node);
        var peers=Array.from(content.querySelectorAll('details')).filter(function(d){return scope(d)===group && d.querySelector('summary').textContent===label;});
        return group+'|'+label+'|'+peers.indexOf(node);
      }
      var opened=new Set(Array.from(content.querySelectorAll('details[open]')).map(disclosureKey));
      var active=document.activeElement, label=active && active.closest('label');
      var buttonActive=active && active.tagName==='BUTTON';
      var activeGroup=active && content.contains(active) ? scope(active) : '';
      var text=label ? caption(label) : buttonActive ? active.textContent : null;
      var selector=label ? 'label' : 'button';
      function matches(){return Array.from(content.querySelectorAll(selector)).filter(function(n){return scope(n)===activeGroup && caption(n)===text;});}
      var oldMatches=text ? matches() : [], index=oldMatches.indexOf(label || active);
      fieldErrors.clear();
      draw();
      Array.from(content.querySelectorAll('details')).forEach(function(d){d.open=opened.has(disclosureKey(d));});
      if(text){
        var candidates=matches(), match=candidates[Math.min(Math.max(index,0),candidates.length-1)];
        var control=match && (label ? match.querySelector('input,select') : match);
        if(!control && buttonActive)control=content.querySelector('button');
        if(control){var ancestor=control.parentElement;while(ancestor && ancestor!==content){if(ancestor.tagName==='DETAILS')ancestor.open=true;ancestor=ancestor.parentElement;}control.focus();}
      }
      changed();
    }
    function optional(parent, o, k, label, initialValue, drawValue) {
      var row = el('div', undefined, parent);
      var labelEl = el('label', undefined, row);
      var check = el('input', undefined, labelEl);
      check.type = 'checkbox';
      check.checked = own(o, k);
      el('span', label, labelEl);
      check.addEventListener('change', function () {
        if (host.disabled) return;
        if (fieldErrors.size) {
          check.checked = own(o, k);
          status.textContent = 'Correct the highlighted entry first.';
          return;
        }
        if (check.checked) o[k] = copy(initialValue);else delete o[k];
        rerender();
      });
      if (own(o, k)) drawValue(row);
    }
    function reference(label, value, fn, parent) {
      var choices = {};
      var keys = ['jobType', 'linearFeet', 'squareFeet', 'material', 'removalRequired', 'gates', 'permitsRequired', 'type'];
      function add(v) {
        if (typeof v === 'string' && !keys.includes(v)) keys.push(v);
      }
      if (kind === 'pricing' && object(state)) {
        (state.requiredScope || []).forEach(add);
        Object.keys(state.allowedScopeValues || {}).forEach(add);
        (state.lineItems || []).forEach(function (r) {
          ['quantityField', 'selectorField', 'collectionField'].forEach(function (k) {
            add(r[k]);
          });
          if (r.when) add(r.when.field);
        });
      }
      add(value);
      keys.forEach(function (k) {
        choices[k] = friendly(k);
      });
      if (value === undefined) choices[''] = 'Choose a job detail';
      select(label, value === undefined ? '' : value, choices, function (v) {
        if (v) fn(v);
      }, parent);
      var custom = details('Use another job detail', parent),
        newName = '';
      el('p', 'Name the detail supplied with the job information. This pricing choice does not add a new field to a job form.', custom);
      input('Job detail name', '', function (v) {
        newName = v;
      }, custom);
      button('Use named detail', function () {
        var existing = keys.filter(function(k){ return friendly(k).toLowerCase() === newName.trim().toLowerCase(); });
        if (existing.length > 1) { status.textContent = 'More than one saved detail has that name. Choose the existing detail from the list.'; return; }
        if (existing.length === 1) { fn(existing[0]); rerender(); return; }
        var words = newName.trim().split(/\s+/);
        var name = words.map(function (w, i) {
          return i ? w.charAt(0).toUpperCase() + w.slice(1) : w.charAt(0).toLowerCase() + w.slice(1);
        }).join('');
        if (!key(name)) {
          status.textContent = 'Choose a short detail name using letters, numbers or dashes.';
          return;
        }
        fn(name);
        rerender();
      }, custom);
    }
    function scalar(parent, value, fn, label, scalarOnly) {
      var t = value === null ? 'none' : Array.isArray(value) ? 'list' : object(value) ? 'group' : typeof value;
      select(label + ' kind', t, scalarOnly ? {
        string: 'Text',
        number: 'Number',
        boolean: 'Yes or no'
      } : {
        string: 'Text',
        number: 'Number',
        boolean: 'Yes or no',
        none: 'No value',
        list: 'List of values',
        group: 'Named values'
      }, function (k) {
        fn({
          string: '',
          number: 0,
          boolean: false,
          none: null,
          list: [],
          group: {}
        }[k]);
        rerender();
      }, parent);
      if (t === 'string' || t === 'number') input(label, value, fn, parent, t === 'number' ? 'number' : 'text');else if (t === 'boolean') select(label, String(value), {
        true: 'Yes',
        false: 'No'
      }, function (v) {
        fn(v === 'true');
      }, parent);else if (t === 'list') {
        value.forEach(function (x, i) {
          var row = el('div', undefined, parent);
          scalar(row, x, function (v) {
            value[i] = v;
          }, label + ' ' + (i + 1));
          button('Remove value', function () {
            value.splice(i, 1);
            rerender();
          }, row);
        });
        button('Add value', function () {
          value.push('');
          rerender();
        }, parent);
      } else if (t === 'group') {
        Object.keys(value).forEach(function (k) {
          var row = el('div', undefined, parent);
          el('strong', friendly(k), row);
          scalar(row, value[k], function (v) {
            value[k] = v;
          }, 'Matching value');
          button('Remove named value', function () {
            delete value[k];
            rerender();
          }, row);
        });
        var newName = '';
        input('New detail name', '', function (v) {
          newName = v;
        }, parent);
        button('Add named value', function () {
          if (!newName.trim() || own(value, newName)) {
            status.textContent = 'Choose a new, nonempty detail name.';
            return;
          }
          Object.defineProperty(value, newName, {
            value: '',
            writable: true,
            enumerable: true,
            configurable: true
          });
          rerender();
        }, parent);
      }
    }
    function mapRows(parent, map, label) {
      Object.keys(map).forEach(function (k) {
        var row = el('div', undefined, parent);
        row.className = 'profile-structured-row';
        input(label, k, function (v) {
          if (!v.trim() || v !== v.toLowerCase() || v !== k && own(map, v)) {
            issue = 'Use a different lowercase choice name.';
            status.textContent = issue;
            return;
          }
          var n = map[k];
          delete map[k];
          Object.defineProperty(map, v, {
            value: n,
            writable: true,
            enumerable: true,
            configurable: true
          });
          k = v;
        }, row);
        input('Price', map[k], function (v) {
          map[k] = v;
        }, row, 'number', 0);
        button('Remove price', function () {
          delete map[k];
          rerender();
        }, row);
      });
      button('Add price', function () {
        if (Object.keys(map).some(function(k){return !k.trim() || !number(map[k],0);})) { status.textContent = 'Complete the current choice and price first.'; return; }
        var n = '';
        map[n] = null;
        rerender();
      }, parent);
    }
    function pricing() {
      optional(content, state, 'requiredScope', 'Require job details', [], function (parent) {
        state.requiredScope.forEach(function (v, i) {
          var row = el('div', undefined, parent);
          reference('Required job detail', v, function (n) {
            state.requiredScope[i] = n;
          }, row);
          button('Remove required detail', function () {
            state.requiredScope.splice(i, 1);
            rerender();
          }, row);
        });
        button('Add required detail', function () {
          state.requiredScope.push('material');
          rerender();
        }, parent);
      });
      optional(content, state, 'allowedScopeValues', 'Limit job details to selected choices', {}, function (parent) {
        Object.keys(state.allowedScopeValues).forEach(function (k) {
          var row = details(friendly(k) + ' choices', parent);
          reference('Job detail', k, function (n) {
            if (n !== k && own(state.allowedScopeValues, n)) {
              status.textContent = 'That detail already has choices.';
              return;
            }
            var v = state.allowedScopeValues[k];
            delete state.allowedScopeValues[k];
            state.allowedScopeValues[n] = v;
            rerender();
          }, row);
          state.allowedScopeValues[k].forEach(function (v, i) {
            scalar(row, v, function (n) {
              state.allowedScopeValues[k][i] = n;
            }, 'Allowed choice ' + (i + 1), true);
            button('Remove choice', function () {
              state.allowedScopeValues[k].splice(i, 1);
              rerender();
            }, row);
          });
          button('Add choice', function () {
            state.allowedScopeValues[k].push('');
            rerender();
          }, row);
          button('Remove detail choices', function () {
            delete state.allowedScopeValues[k];
            rerender();
          }, row);
        });
        button('Add detail choices', function () {
          if (!own(state.allowedScopeValues, 'material')) state.allowedScopeValues.material = [];else {
            status.textContent = 'Material already has choices; choose another job detail in that entry.';
            return;
          }
          rerender();
        }, parent);
      });
      optional(content, state, 'rangePercent', 'Set a price range percentage', 0, function (parent) {
        input('Price range (%)', state.rangePercent, function (v) {
          state.rangePercent = v;
        }, parent, 'number', 0, 100);
      });
      (state.lineItems || []).forEach(function (r, i) {
        var row = details(r.label || 'Charge ' + (i + 1), content);
        row.className = 'profile-structured-charge';
        row.dataset.ruleCode = r.code;
        input('Charge name', r.label, function (v) {
          r.label = v;
          row.querySelector('summary').textContent = v || 'Charge ' + (i + 1);
        }, row);
        select('Cost category', r.category, categories, function (v) {
          r.category = v;
        }, row);
        select('How to charge', r.type, types, function (v) {
          r.type = v;
          rerender();
        }, row);
        if (r.type === 'fixed') input('Charge amount', r.amount, function (v) {
          r.amount = v;
        }, row, 'number', 0);
        if (['perUnit', 'perUnitByValue'].includes(r.type)) reference('Quantity to measure', r.quantityField, function (v) {
          r.quantityField = v;
        }, row);
        if (r.type === 'perUnit') input('Price per unit', r.unitRate, function (v) {
          r.unitRate = v;
        }, row, 'number', 0);
        if (['perUnitByValue', 'perItemByValue'].includes(r.type)) {
          reference('Detail that chooses the price', r.selectorField, function (v) {
            r.selectorField = v;
          }, row);
          if (!r.unitRates) button('Set prices by choice', function () {
            r.unitRates = {};
            rerender();
          }, row);else mapRows(row, r.unitRates, 'Choice name');
        }
        if (r.type === 'perItemByValue') reference('List of items to price', r.collectionField, function (v) {
          r.collectionField = v;
        }, row);
        optional(row, r, 'when', 'Apply only when a job detail matches', {
          field: 'material',
          equals: ''
        }, function (p) {
          reference('Job detail to match', r.when.field, function (v) {
            r.when.field = v;
          }, p);
          scalar(p, r.when.equals, function (v) {
            r.when.equals = v;
          }, 'Matching value');
        });
        button('Move charge up', function () {
          if (i > 0) {
            var x = state.lineItems.splice(i, 1)[0];
            state.lineItems.splice(i - 1, 0, x);
            rerender();
          }
        }, row);
        button('Remove charge', function () {
          state.lineItems.splice(i, 1);
          rerender();
        }, row);
      });
      button('Add charge', function () {
        if (!state.lineItems) state.lineItems = [];
        state.lineItems.push({
          code: 'charge-' + crypto.randomUUID(),
          label: 'New charge',
          category: 'serviceCharge',
          type: 'fixed'
        });
        rerender();
      });
    }
    function costs() {
      Object.keys(state).forEach(function (saved, i) {
        var row = el('div', undefined, content);
        row.className = 'profile-structured-row';
        var current = saved;
        if (kind === 'material' && saved.indexOf(':') > 0) {
          var split = splitMaterial(saved, options.services);
          var choices = {};
          (options.services || []).forEach(function (s) {
            choices[String(s.id).trim().toLowerCase()] = s.name || 'Service';
          });
          if (!own(choices, split.service)) choices[split.service] = 'Saved service ' + (i + 1);
          select('Service', split.service, choices, function (v) {
            if (rename(v + ':' + split.material)) split.service = v;
          }, row);
          input('Material', split.material, function (v) {
            var material = v.toLowerCase();
            if (rename(split.service + ':' + material)) split.material = material;
          }, row);
          el('small', 'Leave Material blank when no material is specified.', row);
        } else input(kind === 'material' ? 'Saved material pricing reference' : 'Equipment pricing reference', saved, rename, row);
        function rename(next) {
          if (!next.trim() || next !== current && own(state, next)) {
            issue = 'Each cost needs a different, nonempty reference.';
            status.textContent = issue;
            return;
          }
          var value = state[current];
          delete state[current];
          Object.defineProperty(state, next, {
            value: value,
            writable: true,
            enumerable: true,
            configurable: true
          });
          current = next;
          return true;
        }
        input('Internal cost', state[saved], function (v) {
          state[current] = v;
        }, row, 'number', 0);
        button('Remove cost', function () {
          delete state[current];
          rerender();
        }, row);
      });
      if (pendingCost) {
        var draft = el('div', undefined, content);
        draft.className = 'profile-structured-row';
        el('strong', 'New material cost', draft);
        var services = {};
        (options.services || []).forEach(function (s) { services[String(s.id).trim().toLowerCase()] = s.name || 'Service'; });
        select('Service for new cost', pendingCost.service, services, function (v) { pendingCost.service = v; }, draft);
        input('Material for new cost', pendingCost.material, function (v) { pendingCost.material = v.toLowerCase(); }, draft);
        input('New internal cost', pendingCost.amount, function (v) { pendingCost.amount = v; }, draft, 'number', 0);
        button('Add this cost', function () {
          var reference = pendingCost.service + ':' + pendingCost.material;
          if (own(state, reference)) { status.textContent = 'A cost already exists for this service and material. Choose another material or edit the existing cost.'; return; }
          if (!number(pendingCost.amount, 0)) { status.textContent = 'Enter the internal cost before adding it.'; return; }
          state[reference] = pendingCost.amount; pendingCost = null; rerender();
        }, draft);
        button('Cancel new cost', function () { pendingCost = null; rerender(); }, draft);
      }
      button('Add cost', function () {
        var prefix = kind === 'material' ? String(((options.services || [])[0] || {}).id || '').trim().toLowerCase() : undefined;
        if (kind === 'material' && !prefix) {
          status.textContent = 'Add a service before adding its material costs.';
          return;
        }
        if (Object.keys(state).length && validate(kind, state)) { status.textContent = 'Complete the current cost row before adding another.'; return; }
        var k = kind === 'material' ? prefix + ':' : '';
        if (pendingCost) { status.textContent = 'Finish or cancel the new material cost first.'; return; }
        if (own(state, k)) { pendingCost = {service: prefix, material: '', amount: null}; rerender(); return; }
        state[k] = null;
        rerender();
      });
    }
    function polygon() {
      state.forEach(function (p, i) {
        var row = el('div', undefined, content);
        row.className = 'profile-structured-row';
        el('strong', 'Point ' + (i + 1), row);
        var a = Array.isArray(p);
        input('Latitude', a ? p[0] : p.latitude, function (v) {
          if (a) p[0] = v;else p.latitude = v;
        }, row, 'number', -90, 90);
        input('Longitude', a ? p[1] : p.longitude, function (v) {
          if (a) p[1] = v;else p.longitude = v;
        }, row, 'number', -180, 180);
        button('Move point up', function () {
          if (i > 0) {
            state.splice(i, 1);
            state.splice(i - 1, 0, p);
            rerender();
          }
        }, row);
        button('Move point down', function () {
          if (i < state.length - 1) {
            state.splice(i, 1);
            state.splice(i + 1, 0, p);
            rerender();
          }
        }, row);
        button('Remove point', function () {
          state.splice(i, 1);
          rerender();
        }, row);
      });
      button('Add point', function () {
        state.push([null, null]);
        rerender();
      });
    }
    function draw() {
      content.replaceChildren();
      status.textContent = '';
      if (unresolved) {
        status.textContent = 'Some saved settings cannot be edited here yet. They are kept unchanged. Reload or contact an administrator for help. Replacing these settings will remove their existing values.';
        button('Replace these settings', function () {
          button('Confirm replacement with empty settings', function () {
            unresolved = false;
            state = kind === 'polygon' ? [] : {};
            rerender();
          });
        });
        sync();
        return;
      }
      if (state === undefined) {
        el('p', kind === 'pricing' ? 'No pricing is configured.' : 'No values are configured.', content);
        button(kind === 'pricing' ? 'Configure pricing' : 'Configure values', function () {
          state = kind === 'polygon' ? [] : {};
          rerender();
        });
      } else {
        if (kind === 'pricing') pricing();else if (kind === 'polygon') polygon();else costs();
        button(kind === 'polygon' ? 'Clear boundary' : kind === 'pricing' ? 'Use no pricing' : 'Remove configuration', function () {
          state = kind === 'polygon' ? [] : undefined;
          rerender();
        });
        if (kind === 'material' || kind === 'equipment') button('Keep an empty cost list', function () {
          state = {};
          rerender();
        });
      }
      sync();
    }
    var api = {
      load: function (value, newOptions) {
        if (newOptions) options = newOptions;
        state = copy(value);
        unresolved = !shape(kind, state);
        fieldErrors.clear();
        pendingCost = null;
        issue = '';
        carrier.value = state === undefined ? '' : JSON.stringify(state);
        draw();
      },
      read: function () {
        var message = issue || Array.from(fieldErrors.values())[0] || (pendingCost ? 'Finish or cancel the new material cost before saving.' : '') || (unresolved ? 'Review or explicitly replace the unresolved settings before saving.' : validate(kind, state));
        if (message) {
          status.textContent = message;
          throw new Error(message);
        }
        return copy(state);
      },
      sync: sync
    };
    carrier._profileFields = api;
    draw();
    return api;
  }
  return {
    mount: mount,
    validate: validate,
    shape: shape,
    splitMaterial: splitMaterial
  };
});
