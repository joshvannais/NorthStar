(function (global, factory) {
  'use strict';

  var api = factory(global);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global && global.document) global.NorthStarNavigationLauncher = api;
})(typeof window !== 'undefined' ? window : globalThis, function (global) {
  'use strict';

  var AUTHORITY = 'canonical_map_preferences_v1';
  var PROVIDERS = Object.freeze([
    Object.freeze({ key: 'google_maps', name: 'Google Maps' }),
    Object.freeze({ key: 'apple_maps', name: 'Apple Maps' }),
    Object.freeze({ key: 'waze', name: 'Waze' }),
  ]);
  var PROVIDER_KEYS = Object.freeze(PROVIDERS.map(function (provider) { return provider.key; }));
  var PROVIDER_NAMES = Object.freeze({
    google_maps: 'Google Maps',
    apple_maps: 'Apple Maps',
    waze: 'Waze',
  });
  var MAX_ADDRESS_LENGTH = 512;
  var MAX_URL_LENGTH = 2048;
  var instances = [];
  var preferenceGeneration = 0;
  var preferenceState = {
    kind: 'idle',
    authorityKey: null,
    preferences: null,
    pending: null,
  };

  function destinationFailure() {
    throw new Error('Navigation destination is invalid.');
  }

  function preferenceFailure() {
    throw new Error('Map preference response is invalid.');
  }

  function providerFailure() {
    throw new Error('Navigation provider is invalid.');
  }

  function urlFailure() {
    throw new Error('Navigation URL is invalid.');
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function dataRecord(value, allowed, required, failure) {
    var prototype;
    var keys;
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) failure();
      prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) failure();
      keys = Reflect.ownKeys(value);
    } catch (_error) {
      failure();
    }
    if (keys.some(function (key) { return typeof key !== 'string' || allowed.indexOf(key) < 0; })) failure();
    if (required.some(function (key) { return keys.indexOf(key) < 0; })) failure();
    var result = Object.create(null);
    keys.forEach(function (key) {
      var descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (_error) { failure(); }
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) failure();
      result[key] = descriptor.value;
    });
    return result;
  }

  function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
  }

  function hasLoneSurrogate(value) {
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (index + 1 >= value.length) return true;
        var next = value.charCodeAt(index + 1);
        if (next < 0xDC00 || next > 0xDFFF) return true;
        index += 1;
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        return true;
      }
    }
    return false;
  }

  function cleanAddressPart(value, maximum, required) {
    if (typeof value !== 'string' || value.length > maximum || hasLoneSurrogate(value) ||
        /[<>\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(value)) destinationFailure();
    var trimmed = value.trim();
    if ((required && !trimmed) || trimmed.length > maximum) destinationFailure();
    return trimmed;
  }

  function normalizeAddress(value) {
    var address;
    if (typeof value === 'string') {
      address = cleanAddressPart(value, MAX_ADDRESS_LENGTH, true);
    } else {
      var record = dataRecord(
        value,
        ['line1', 'line2', 'city', 'state', 'postalCode', 'country'],
        ['line1'],
        destinationFailure
      );
      var line1 = cleanAddressPart(record.line1, 256, true);
      var line2 = hasOwn(record, 'line2') ? cleanAddressPart(record.line2, 256, false) : '';
      var city = hasOwn(record, 'city') ? cleanAddressPart(record.city, 128, false) : '';
      var state = hasOwn(record, 'state') ? cleanAddressPart(record.state, 64, false) : '';
      var postalCode = hasOwn(record, 'postalCode') ? cleanAddressPart(record.postalCode, 64, false) : '';
      var country = hasOwn(record, 'country') ? cleanAddressPart(record.country, 64, false) : '';
      var statePostal = [state, postalCode].filter(Boolean).join(' ');
      address = [line1, line2, city, statePostal, country].filter(Boolean).join(', ');
      if (!address || address.length > MAX_ADDRESS_LENGTH) destinationFailure();
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*\s*:/.test(address)) destinationFailure();
    return address;
  }

  function normalizeCoordinates(value) {
    var record = dataRecord(
      value,
      ['verified', 'latitude', 'longitude'],
      ['verified', 'latitude', 'longitude'],
      destinationFailure
    );
    if (record.verified !== true || typeof record.latitude !== 'number' ||
        typeof record.longitude !== 'number' || !Number.isFinite(record.latitude) ||
        !Number.isFinite(record.longitude) || record.latitude < -90 || record.latitude > 90 ||
        record.longitude < -180 || record.longitude > 180) destinationFailure();
    return Object.freeze({
      latitude: Object.is(record.latitude, -0) ? 0 : record.latitude,
      longitude: Object.is(record.longitude, -0) ? 0 : record.longitude,
    });
  }

  function normalizeDestination(input) {
    var record = dataRecord(
      input,
      ['address', 'verifiedCoordinates'],
      ['address'],
      destinationFailure
    );
    var coordinates = hasOwn(record, 'verifiedCoordinates')
      ? normalizeCoordinates(record.verifiedCoordinates)
      : null;
    return Object.freeze({
      address: normalizeAddress(record.address),
      verifiedCoordinates: coordinates,
    });
  }

  function normalizedDestination(input) {
    var record = dataRecord(
      input,
      ['address', 'verifiedCoordinates'],
      ['address', 'verifiedCoordinates'],
      destinationFailure
    );
    var address = normalizeAddress(record.address);
    if (record.verifiedCoordinates === null) {
      return { address: address, verifiedCoordinates: null };
    }
    var coordinates = dataRecord(
      record.verifiedCoordinates,
      ['latitude', 'longitude'],
      ['latitude', 'longitude'],
      destinationFailure
    );
    if (typeof coordinates.latitude !== 'number' || typeof coordinates.longitude !== 'number' ||
        !Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude) ||
        coordinates.latitude < -90 || coordinates.latitude > 90 ||
        coordinates.longitude < -180 || coordinates.longitude > 180) destinationFailure();
    return {
      address: address,
      verifiedCoordinates: {
        latitude: Object.is(coordinates.latitude, -0) ? 0 : coordinates.latitude,
        longitude: Object.is(coordinates.longitude, -0) ? 0 : coordinates.longitude,
      },
    };
  }

  function validateNavigationUrl(provider, candidate) {
    if (PROVIDER_KEYS.indexOf(provider) < 0) providerFailure();
    if (typeof candidate !== 'string' || !candidate || candidate.length > MAX_URL_LENGTH ||
        /[^\x20-\x7E]/.test(candidate)) urlFailure();
    var parsed;
    try { parsed = new URL(candidate); } catch (_error) { urlFailure(); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash) urlFailure();

    var keys = Array.from(parsed.searchParams.keys());
    var expected;
    if (provider === 'apple_maps') {
      if (parsed.hostname !== 'maps.apple.com' || parsed.pathname !== '/' ||
          keys.length !== 2 || keys[0] !== 'daddr' || keys[1] !== 'dirflg' ||
          !parsed.searchParams.get('daddr') || parsed.searchParams.get('dirflg') !== 'd') urlFailure();
      expected = 'https://maps.apple.com/?daddr=' + encodeURIComponent(parsed.searchParams.get('daddr')) + '&dirflg=d';
    } else if (provider === 'google_maps') {
      if (parsed.hostname !== 'www.google.com' || parsed.pathname !== '/maps/dir/' ||
          keys.length !== 2 || keys[0] !== 'api' || keys[1] !== 'destination' ||
          parsed.searchParams.get('api') !== '1' || !parsed.searchParams.get('destination')) urlFailure();
      expected = 'https://www.google.com/maps/dir/?api=1&destination=' +
        encodeURIComponent(parsed.searchParams.get('destination'));
    } else {
      if (parsed.hostname !== 'waze.com' || parsed.pathname !== '/ul' || keys.length !== 2 ||
          keys[0] !== 'q' || keys[1] !== 'navigate' ||
          !parsed.searchParams.get('q') || parsed.searchParams.get('navigate') !== 'yes') urlFailure();
      expected = 'https://waze.com/ul?q=' +
        encodeURIComponent(parsed.searchParams.get('q')) + '&navigate=yes';
    }
    if (candidate !== expected || expected.length > MAX_URL_LENGTH) urlFailure();
    return candidate;
  }

  function buildNavigationUrl(provider, input) {
    if (PROVIDER_KEYS.indexOf(provider) < 0) providerFailure();
    var destination = normalizedDestination(input);
    var coordinates = destination.verifiedCoordinates;
    var location = coordinates
      ? String(coordinates.latitude) + ',' + String(coordinates.longitude)
      : destination.address;
    var encoded = encodeURIComponent(location);
    var url;
    if (provider === 'apple_maps') {
      url = 'https://maps.apple.com/?daddr=' + encoded + '&dirflg=d';
    } else if (provider === 'google_maps') {
      url = 'https://www.google.com/maps/dir/?api=1&destination=' + encoded;
    } else {
      url = 'https://waze.com/ul?q=' + encoded + '&navigate=yes';
    }
    return validateNavigationUrl(provider, url);
  }

  function safeInteger(value, minimum) {
    if (!Number.isSafeInteger(value) || value < minimum) preferenceFailure();
    return value;
  }

  function timestamp(value, nullable) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || !value || value.length > 64) preferenceFailure();
    var date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) preferenceFailure();
    return value;
  }

  function parsePreferenceDocument(input) {
    var record = dataRecord(input, ['providers', 'defaultProvider'], ['providers', 'defaultProvider'], preferenceFailure);
    var providerRecord = dataRecord(record.providers, PROVIDER_KEYS, PROVIDER_KEYS, preferenceFailure);
    var result = { providers: {}, defaultProvider: record.defaultProvider };
    PROVIDER_KEYS.forEach(function (key) {
      var state = dataRecord(providerRecord[key], ['enabled', 'visible'], ['enabled', 'visible'], preferenceFailure);
      if (typeof state.enabled !== 'boolean' || typeof state.visible !== 'boolean') preferenceFailure();
      result.providers[key] = { enabled: state.enabled, visible: state.visible };
    });
    if (PROVIDER_KEYS.indexOf(result.defaultProvider) < 0 ||
        !result.providers[result.defaultProvider].enabled ||
        !PROVIDER_KEYS.some(function (key) { return result.providers[key].enabled; })) preferenceFailure();
    return result;
  }

  function samePreferenceDocument(left, right) {
    return left.defaultProvider === right.defaultProvider && PROVIDER_KEYS.every(function (key) {
      return left.providers[key].enabled === right.providers[key].enabled &&
        left.providers[key].visible === right.providers[key].visible;
    });
  }

  function parsePreferenceResponse(input) {
    var envelope = dataRecord(input, ['success', 'data', 'requestId'], ['success', 'data', 'requestId'], preferenceFailure);
    if (envelope.success !== true || typeof envelope.requestId !== 'string' || !envelope.requestId ||
        envelope.requestId.length > 256 || /[\u0000-\u001F\u007F-\u009F]/.test(envelope.requestId)) preferenceFailure();
    var data = dataRecord(
      envelope.data,
      ['authority', 'contractVersion', 'providers', 'organization', 'user', 'effective', 'permissions'],
      ['authority', 'contractVersion', 'providers', 'organization', 'user', 'effective', 'permissions'],
      preferenceFailure
    );
    if (data.authority !== AUTHORITY || data.contractVersion !== 1 || !Array.isArray(data.providers) ||
        data.providers.length !== PROVIDERS.length) preferenceFailure();
    data.providers.forEach(function (provider, index) {
      var item = dataRecord(provider, ['key', 'name'], ['key', 'name'], preferenceFailure);
      if (item.key !== PROVIDERS[index].key || item.name !== PROVIDERS[index].name) preferenceFailure();
    });

    var organization = dataRecord(
      data.organization,
      ['version', 'preferences', 'source', 'updatedAt'],
      ['version', 'preferences', 'source', 'updatedAt'],
      preferenceFailure
    );
    organization.version = safeInteger(organization.version, 1);
    organization.preferences = parsePreferenceDocument(organization.preferences);
    if (organization.source !== 'system_default' && organization.source !== 'user') preferenceFailure();
    timestamp(organization.updatedAt, false);

    var user = dataRecord(
      data.user,
      ['version', 'mode', 'hasStoredAuthority', 'preferences', 'updatedAt'],
      ['version', 'mode', 'hasStoredAuthority', 'preferences', 'updatedAt'],
      preferenceFailure
    );
    user.version = safeInteger(user.version, 0);
    if ((user.mode !== 'inherit' && user.mode !== 'override') || typeof user.hasStoredAuthority !== 'boolean') preferenceFailure();
    if (!user.hasStoredAuthority) {
      if (user.version !== 0 || user.mode !== 'inherit' || user.preferences !== null || user.updatedAt !== null) preferenceFailure();
    } else {
      if (user.version < 1) preferenceFailure();
      timestamp(user.updatedAt, false);
      if (user.mode === 'inherit') {
        if (user.preferences !== null) preferenceFailure();
      } else {
        user.preferences = parsePreferenceDocument(user.preferences);
      }
    }

    var effective = dataRecord(
      data.effective,
      ['source', 'inheritsOrganization', 'organizationVersion', 'userVersion', 'preferences'],
      ['source', 'inheritsOrganization', 'organizationVersion', 'userVersion', 'preferences'],
      preferenceFailure
    );
    effective.organizationVersion = safeInteger(effective.organizationVersion, 1);
    effective.userVersion = safeInteger(effective.userVersion, 0);
    effective.preferences = parsePreferenceDocument(effective.preferences);
    if (typeof effective.inheritsOrganization !== 'boolean' ||
        effective.organizationVersion !== organization.version || effective.userVersion !== user.version) preferenceFailure();
    if (effective.inheritsOrganization) {
      if (effective.source !== 'organization' || user.mode !== 'inherit' ||
          !samePreferenceDocument(effective.preferences, organization.preferences)) preferenceFailure();
    } else if (effective.source !== 'user_override' || user.mode !== 'override' ||
               !user.preferences || !samePreferenceDocument(effective.preferences, user.preferences)) {
      preferenceFailure();
    }

    var permissions = dataRecord(
      data.permissions,
      ['canUpdateOrganization', 'canUpdateSelf'],
      ['canUpdateOrganization', 'canUpdateSelf'],
      preferenceFailure
    );
    if (typeof permissions.canUpdateOrganization !== 'boolean' || permissions.canUpdateSelf !== true) preferenceFailure();
    return deepFreeze(effective.preferences);
  }

  function selectLaunchPolicy(preferences) {
    var parsed = parsePreferenceDocument(preferences);
    var usable = PROVIDER_KEYS.filter(function (key) {
      return parsed.providers[key].enabled && parsed.providers[key].visible;
    });
    var defaultProvider = usable.indexOf(parsed.defaultProvider) >= 0 ? parsed.defaultProvider : null;
    return deepFreeze({
      defaultProvider: defaultProvider,
      usableProviders: usable,
      chooserProviders: defaultProvider
        ? usable.filter(function (key) { return key !== defaultProvider; })
        : usable.slice(),
    });
  }

  function selectedDataValue(object, key) {
    var prototype;
    var descriptor;
    try {
      if (!object || typeof object !== 'object' || Array.isArray(object)) return null;
      prototype = Object.getPrototypeOf(object);
      if (prototype !== Object.prototype && prototype !== null) return null;
      descriptor = Object.getOwnPropertyDescriptor(object, key);
    } catch (_error) {
      return null;
    }
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
    return descriptor.value;
  }

  function accountAuthorityKey(account) {
    var user = selectedDataValue(account, 'user');
    var organization = selectedDataValue(account, 'organization');
    var userId = selectedDataValue(user, 'id');
    var organizationId = selectedDataValue(organization, 'id');
    if (typeof userId !== 'string' || !userId || userId.length > 128 ||
        typeof organizationId !== 'string' || !organizationId || organizationId.length > 128) return null;
    return organizationId + ':' + userId;
  }

  function sessionClient() {
    var client = global.NorthStarAccountSession;
    if (!client || typeof client.load !== 'function' || typeof client.json !== 'function' ||
        typeof client.getAccount !== 'function') return null;
    return client;
  }

  function currentAuthorityKey() {
    var client = sessionClient();
    return client ? accountAuthorityKey(client.getAccount()) : null;
  }

  function notifyInstances() {
    instances = instances.filter(function (instance) {
      if (!instance.root || instance.destroyed || !instance.root.isConnected) {
        if (instance.cleanup) instance.cleanup();
        return false;
      }
      renderInstance(instance);
      return true;
    });
  }

  function loadPreferences(force) {
    var client = sessionClient();
    if (!client) {
      preferenceState = { kind: 'error', authorityKey: null, preferences: null, pending: null };
      notifyInstances();
      return Promise.reject(new Error('Account preference authority is unavailable.'));
    }
    return client.load().then(function (account) {
      var authorityKey = accountAuthorityKey(account);
      if (!authorityKey) throw new Error('Account preference authority is unavailable.');
      if (!force && preferenceState.kind === 'ready' && preferenceState.authorityKey === authorityKey) {
        return preferenceState.preferences;
      }
      if (!force && preferenceState.kind === 'loading' && preferenceState.authorityKey === authorityKey && preferenceState.pending) {
        return preferenceState.pending;
      }

      var generation = ++preferenceGeneration;
      var pending;
      preferenceState = { kind: 'loading', authorityKey: authorityKey, preferences: null, pending: null };
      notifyInstances();
      pending = client.json('/api/account/map-preferences', { method: 'GET', cache: 'no-store' })
        .then(function (body) {
          var preferences = parsePreferenceResponse(body);
          if (generation !== preferenceGeneration || currentAuthorityKey() !== authorityKey) return null;
          preferenceState = { kind: 'ready', authorityKey: authorityKey, preferences: preferences, pending: null };
          notifyInstances();
          return preferences;
        })
        .catch(function (error) {
          if (generation !== preferenceGeneration) return null;
          preferenceState = { kind: 'error', authorityKey: authorityKey, preferences: null, pending: null };
          notifyInstances();
          throw error;
        });
      preferenceState.pending = pending;
      return pending;
    }).catch(function (error) {
      if (preferenceState.kind !== 'error') {
        preferenceState = { kind: 'error', authorityKey: null, preferences: null, pending: null };
        notifyInstances();
      }
      throw error;
    });
  }

  function element(tag, className, text) {
    var node = global.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setStatus(instance, message, alert) {
    if (!instance.status) return;
    instance.status.textContent = message;
    instance.status.setAttribute('role', alert ? 'alert' : 'status');
    instance.status.setAttribute('aria-live', alert ? 'assertive' : 'polite');
  }

  function renderGlyphButton(button, label) {
    var glyph = element('span', 'navigation-launcher__glyph', '\u2197');
    glyph.setAttribute('aria-hidden', 'true');
    button.appendChild(glyph);
    button.appendChild(element('span', '', label));
  }

  function renderInstance(instance) {
    if (instance.cleanup) instance.cleanup();
    instance.cleanup = null;
    instance.root.replaceChildren();
    instance.root.className = 'navigation-launcher';
    instance.root.dataset.state = 'loading';

    var controls = element('div', 'navigation-launcher__controls');
    var primary = element('button', 'navigation-launcher__primary');
    primary.type = 'button';
    primary.setAttribute('data-navigation-primary', '');
    primary.disabled = true;
    renderGlyphButton(primary, 'Navigate');
    var chooser = element('button', 'navigation-launcher__chooser', 'Other maps');
    chooser.type = 'button';
    chooser.setAttribute('data-navigation-chooser', '');
    chooser.setAttribute('aria-haspopup', 'menu');
    chooser.setAttribute('aria-expanded', 'false');
    chooser.hidden = true;
    var menu = element('div', 'navigation-launcher__menu');
    menu.id = (instance.root.id || 'navigationLauncher') + 'Menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Enabled navigation providers');
    menu.hidden = true;
    chooser.setAttribute('aria-controls', menu.id);
    var status = element('p', 'navigation-launcher__status');
    status.setAttribute('data-navigation-status', '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    controls.appendChild(primary);
    controls.appendChild(chooser);
    instance.root.appendChild(controls);
    instance.root.appendChild(menu);
    instance.root.appendChild(status);
    instance.primary = primary;
    instance.chooser = chooser;
    instance.menu = menu;
    instance.status = status;

    if (!instance.destination) {
      instance.root.dataset.state = 'unavailable';
      primary.setAttribute('aria-label', 'Navigate unavailable: destination address is missing or invalid');
      setStatus(instance, 'Navigation unavailable: the destination address is missing or invalid.', true);
      return;
    }
    if (preferenceState.kind === 'loading' || preferenceState.kind === 'idle') {
      primary.setAttribute('aria-label', 'Navigate loading');
      setStatus(instance, 'Loading navigation preferences\u2026', false);
      return;
    }
    if (preferenceState.kind === 'error' || preferenceState.authorityKey !== currentAuthorityKey()) {
      instance.root.dataset.state = 'error';
      primary.setAttribute('aria-label', 'Navigate unavailable: preferences could not be loaded');
      setStatus(instance, 'Navigation preferences could not be loaded. Try again.', true);
      var retry = element('button', 'navigation-launcher__retry', 'Try again');
      retry.type = 'button';
      retry.setAttribute('data-navigation-retry', '');
      retry.addEventListener('click', function (event) {
        if (!event.isTrusted) return;
        loadPreferences(true).then(function () {
          if (instance.primary) instance.primary.focus();
        }).catch(function () {
          if (instance.root.isConnected) {
            var nextRetry = instance.root.querySelector('[data-navigation-retry]');
            if (nextRetry) nextRetry.focus();
          }
        });
      });
      instance.root.appendChild(retry);
      return;
    }

    var policy;
    try { policy = selectLaunchPolicy(preferenceState.preferences); } catch (_error) {
      instance.root.dataset.state = 'error';
      primary.setAttribute('aria-label', 'Navigate unavailable: preferences are invalid');
      setStatus(instance, 'Navigation preferences are invalid. Try again.', true);
      return;
    }
    if (!policy.usableProviders.length) {
      instance.root.dataset.state = 'unavailable';
      primary.setAttribute('aria-label', 'Navigate unavailable: no enabled and visible provider');
      setStatus(instance, 'Navigation is unavailable because no enabled and visible map provider is configured.', false);
      return;
    }

    instance.root.dataset.state = 'ready';
    primary.disabled = false;
    var destinationLabel = instance.destination.address;
    if (policy.defaultProvider) {
      primary.replaceChildren();
      renderGlyphButton(primary, 'Navigate');
      primary.setAttribute('aria-label', 'Navigate with ' + PROVIDER_NAMES[policy.defaultProvider] + ' to ' + destinationLabel);
    } else {
      primary.replaceChildren();
      renderGlyphButton(primary, 'Choose map');
      primary.setAttribute('aria-label', 'Choose a map provider to navigate to ' + destinationLabel);
    }
    chooser.hidden = policy.chooserProviders.length === 0;
    chooser.setAttribute('aria-label', policy.defaultProvider ? 'Choose another map provider' : 'Choose a map provider');
    policy.chooserProviders.forEach(function (key) {
      var button = element('button', 'navigation-launcher__provider');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('data-navigation-provider', key);
      renderGlyphButton(button, PROVIDER_NAMES[key]);
      button.addEventListener('click', function (event) {
        if (!event.isTrusted) return;
        closeMenu(true);
        launchProvider(instance, key);
      });
      menu.appendChild(button);
    });

    var outsideHandler = null;
    var keyHandler = null;
    var lastOpener = null;
    function closeMenu(returnFocus) {
      if (menu.hidden) return;
      menu.hidden = true;
      chooser.setAttribute('aria-expanded', 'false');
      if (outsideHandler) global.document.removeEventListener('click', outsideHandler, true);
      if (keyHandler) global.document.removeEventListener('keydown', keyHandler, true);
      outsideHandler = null;
      keyHandler = null;
      if (returnFocus && lastOpener && lastOpener.isConnected) lastOpener.focus();
    }
    function openMenu(opener) {
      if (!menu.children.length) return;
      menu.hidden = false;
      chooser.setAttribute('aria-expanded', 'true');
      lastOpener = opener;
      outsideHandler = function (event) {
        if (!instance.root.contains(event.target)) closeMenu(true);
      };
      keyHandler = function (event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMenu(true);
        }
      };
      global.document.addEventListener('click', outsideHandler, true);
      global.document.addEventListener('keydown', keyHandler, true);
      menu.querySelector('[data-navigation-provider]').focus();
    }
    instance.cleanup = function () { closeMenu(false); };
    primary.addEventListener('click', function (event) {
      if (!event.isTrusted) return;
      if (policy.defaultProvider) launchProvider(instance, policy.defaultProvider);
      else openMenu(primary);
    });
    chooser.addEventListener('click', function (event) {
      if (!event.isTrusted) return;
      if (menu.hidden) openMenu(chooser);
      else closeMenu(true);
    });
    setStatus(instance, 'Navigation is ready for ' + destinationLabel + '.', false);
  }

  function launchProvider(instance, provider) {
    if (!instance.destination || preferenceState.kind !== 'ready' ||
        preferenceState.authorityKey !== currentAuthorityKey()) {
      setStatus(instance, 'Navigation preferences changed. Reloading before navigation.', true);
      loadPreferences(true).catch(function () {});
      return;
    }
    var policy;
    try { policy = selectLaunchPolicy(preferenceState.preferences); } catch (_error) { return; }
    if (policy.usableProviders.indexOf(provider) < 0) {
      setStatus(instance, 'That navigation provider is no longer available.', true);
      return;
    }
    var url;
    try {
      url = buildNavigationUrl(provider, instance.destination);
      validateNavigationUrl(provider, url);
    } catch (_error) {
      setStatus(instance, 'The destination could not be opened safely.', true);
      return;
    }
    var opened = null;
    try {
      opened = global.open(url, '_blank', 'noopener,noreferrer');
      if (opened) opened.opener = null;
    } catch (_error) {
      opened = null;
    }
    if (!opened) {
      setStatus(instance, PROVIDER_NAMES[provider] + ' was blocked or could not be opened. Allow pop-ups and try again.', true);
      return;
    }
    setStatus(instance, 'Opened ' + PROVIDER_NAMES[provider] + ' for ' + instance.destination.address + '.', false);
  }

  function mount(root, options) {
    if (!global.document || !root || typeof root.replaceChildren !== 'function') {
      throw new Error('Navigation launcher mount is invalid.');
    }
    var instance = { root: root, destination: null, label: 'jobsite', cleanup: null, destroyed: false };
    try {
      var record = dataRecord(options, ['address', 'verifiedCoordinates', 'label'], ['address'], destinationFailure);
      var input = { address: record.address };
      if (hasOwn(record, 'verifiedCoordinates')) input.verifiedCoordinates = record.verifiedCoordinates;
      instance.destination = normalizeDestination(input);
      if (hasOwn(record, 'label')) {
        if (typeof record.label !== 'string' || !record.label.trim() || record.label.length > 160 ||
            /[\u0000-\u001F\u007F-\u009F]/.test(record.label)) destinationFailure();
        instance.label = record.label.trim();
      }
    } catch (_error) {
      instance.destination = null;
    }
    instances = instances.filter(function (current) {
      if (current.root !== root) return true;
      current.destroyed = true;
      if (current.cleanup) current.cleanup();
      return false;
    });
    instances.push(instance);
    renderInstance(instance);
    if (preferenceState.kind === 'idle' || preferenceState.authorityKey !== currentAuthorityKey()) {
      loadPreferences(false).catch(function () {});
    }
    return Object.freeze({
      destination: instance.destination,
      destroy: function () {
        instance.destroyed = true;
        if (instance.cleanup) instance.cleanup();
        instance.root.replaceChildren();
      },
    });
  }

  function reload() {
    return loadPreferences(true);
  }

  if (global && typeof global.addEventListener === 'function') {
    global.addEventListener('northstar:account', function (event) {
      var nextKey = accountAuthorityKey(event && event.detail);
      if (nextKey === preferenceState.authorityKey) return;
      preferenceGeneration += 1;
      preferenceState = { kind: nextKey ? 'idle' : 'error', authorityKey: nextKey, preferences: null, pending: null };
      notifyInstances();
      if (nextKey && instances.length) loadPreferences(true).catch(function () {});
    });
  }

  return Object.freeze({
    AUTHORITY: AUTHORITY,
    PROVIDERS: PROVIDERS,
    buildNavigationUrl: buildNavigationUrl,
    mount: mount,
    normalizeDestination: normalizeDestination,
    parsePreferenceResponse: parsePreferenceResponse,
    reload: reload,
    selectLaunchPolicy: selectLaunchPolicy,
    validateNavigationUrl: validateNavigationUrl,
  });
});
