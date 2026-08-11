'use strict';

const { readCanonicalIntegrationStatuses } = require('./status');

const CATALOGUE_AUTHORITY = 'northstar_integration_catalogue_v1';
const CATALOGUE_VERSION = 1;

const PRESENTATION_LABELS = Object.freeze({
  available: 'Available',
  coming_soon: 'Coming soon',
  requires_provider_approval: 'Requires provider approval',
  connected: 'Connected',
  syncing: 'Syncing',
  needs_attention: 'Needs attention',
  disconnected: 'Disconnected',
});
const PRESENTATION_STATES = Object.freeze(Object.keys(PRESENTATION_LABELS));

const UNAVAILABLE_CAPABILITIES = Object.freeze({
  management: 'unavailable',
  authorization: 'unavailable',
  scopes: 'unavailable',
  dataDirection: 'none',
  sync: 'unavailable',
  lastSync: 'unavailable',
  error: 'unavailable',
  reconnect: 'unavailable',
  mappings: 'unavailable',
  webhookHealth: 'unavailable',
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const CATEGORY_DEFINITIONS = deepFreeze([
  {
    key: 'communications_ai',
    label: 'Communications & AI',
    providers: [
      {
        key: 'retell', name: 'Retell', mark: 'RT',
        description: 'Canonical voice ownership exists only when NorthStar has a reviewed tenant record.',
        dynamicProvider: 'retell',
        configuration: 'canonical_business_profiles.voiceAssistant',
        connection: 'canonical_integration_ownership',
      },
      {
        key: 'voice', name: 'NorthStar Voice', mark: 'VO',
        description: 'Provider-neutral voice ownership used by canonical voice sessions.',
        dynamicProvider: 'voice',
        configuration: 'canonical_business_profiles.voiceAssistant',
        connection: 'canonical_integration_ownership',
      },
      {
        key: 'twilio', name: 'Twilio', mark: 'TW',
        description: 'Notification recipients are owned separately; tenant connector authority is not available.',
        basis: 'authority_missing',
      },
      {
        key: 'openai', name: 'OpenAI', mark: 'OA',
        description: 'No tenant-scoped provider connection authority is available in this catalogue.',
        basis: 'authority_missing',
      },
      {
        key: 'elevenlabs', name: 'ElevenLabs', mark: 'EL',
        description: 'No tenant-scoped voice-provider connection authority is available.',
        basis: 'authority_missing',
      },
      {
        key: 'email', name: 'Email', mark: 'EM',
        description: 'Email notification preferences are separate from provider connection authority.',
        basis: 'authority_missing',
      },
    ],
  },
  {
    key: 'calendar_scheduling',
    label: 'Calendar & Scheduling',
    providers: [
      {
        key: 'google_calendar', name: 'Google Calendar', mark: 'GC',
        description: 'NorthStar Calendar does not establish a Google Calendar connection.',
        basis: 'authority_missing',
      },
      {
        key: 'microsoft_calendar', name: 'Microsoft Calendar', mark: 'MC',
        description: 'No tenant-scoped Microsoft Calendar connection authority is available.',
        basis: 'authority_missing',
      },
      {
        key: 'apple_calendar', name: 'Apple Calendar', mark: 'AC',
        description: 'No tenant-scoped Apple Calendar connection authority is available.',
        basis: 'authority_missing',
      },
    ],
  },
  {
    key: 'accounting_payments',
    label: 'Accounting & Payments',
    providers: [
      {
        key: 'quickbooks', name: 'QuickBooks', mark: 'QB',
        description: 'Accounting connector authority and sync domains are not available.',
        basis: 'authority_missing',
      },
      {
        key: 'stripe', name: 'Stripe', mark: 'ST',
        description: 'Subscription records do not establish a Stripe provider connection.',
        basis: 'provider_approval_required',
        presentationState: 'requires_provider_approval',
      },
      {
        key: 'square', name: 'Square', mark: 'SQ',
        description: 'Payment-provider connection authority is not available.',
        basis: 'authority_missing',
      },
    ],
  },
  {
    key: 'field_service_crm',
    label: 'Field Service & CRM',
    providers: [
      {
        key: 'jobber', name: 'Jobber', mark: 'JB',
        description: 'Production connection capability is source-disabled pending durable authority.',
        basis: 'source_disabled',
      },
      {
        key: 'housecall_pro', name: 'Housecall Pro', mark: 'HP',
        description: 'No canonical connector authority is available.',
        basis: 'authority_missing',
      },
      {
        key: 'servicetitan', name: 'ServiceTitan', mark: 'SV',
        description: 'A future read-only field-service and inventory connector is planned; authority is not available.',
        basis: 'deferred_read_only_connector',
      },
      {
        key: 'salesforce', name: 'Salesforce', mark: 'SF',
        description: 'No canonical CRM connector authority is available.',
        basis: 'authority_missing',
      },
    ],
  },
  {
    key: 'workflow_data',
    label: 'Workflow & Data',
    providers: [
      {
        key: 'google_sheets', name: 'Google Sheets', mark: 'GS',
        description: 'Legacy global adapter state is not tenant connector authority.',
        basis: 'authority_missing',
      },
      {
        key: 'zapier', name: 'Zapier', mark: 'ZP',
        description: 'No tenant-scoped workflow connector authority is available.',
        basis: 'authority_missing',
      },
    ],
  },
  {
    key: 'maps_navigation',
    label: 'Maps & Navigation',
    providers: [
      {
        key: 'google_maps', name: 'Google Maps', mark: 'GM',
        description: 'Canonical provider preferences are managed in the Map launch preferences panel below; provider connection and destination-launch/navigation actions are not included.',
        basis: 'catalogue_only_navigation_deferred',
      },
      {
        key: 'apple_maps', name: 'Apple Maps', mark: 'AM',
        description: 'Canonical provider preferences are managed in the Map launch preferences panel below; provider connection and destination-launch/navigation actions are not included.',
        basis: 'catalogue_only_navigation_deferred',
      },
      {
        key: 'waze', name: 'Waze', mark: 'WZ',
        description: 'Canonical provider preferences are managed in the Map launch preferences panel below; provider connection and destination-launch/navigation actions are not included.',
        basis: 'catalogue_only_navigation_deferred',
      },
    ],
  },
  {
    key: 'enterprise_assets_inventory',
    label: 'Enterprise Assets & Inventory',
    providers: [
      {
        key: 'procore', name: 'Procore', mark: 'PC',
        description: 'A future read-only enterprise connector is planned; authority is not available.',
        basis: 'deferred_read_only_connector',
      },
      {
        key: 'netsuite', name: 'NetSuite', mark: 'NS',
        description: 'A future read-only ERP connector is planned; authority is not available.',
        basis: 'deferred_read_only_connector',
      },
      {
        key: 'dynamics_365', name: 'Dynamics 365', mark: 'D3',
        description: 'A future read-only ERP connector is planned; authority is not available.',
        basis: 'deferred_read_only_connector',
      },
      {
        key: 'samsara', name: 'Samsara', mark: 'SM',
        description: 'A future read-only fleet connector is planned; authority is not available.',
        basis: 'deferred_read_only_connector',
      },
      {
        key: 'fleetio', name: 'Fleetio', mark: 'FL',
        description: 'A future read-only fleet connector is planned; authority is not available.',
        basis: 'deferred_read_only_connector',
      },
    ],
  },
]);

const CATEGORY_KEYS = Object.freeze(CATEGORY_DEFINITIONS.map(category => category.key));
const PROVIDER_KEYS = Object.freeze(CATEGORY_DEFINITIONS.flatMap(category => (
  category.providers.map(provider => provider.key)
)));

const OWNERSHIP_PRESENTATION = Object.freeze({
  active: 'connected',
  inactive: 'disconnected',
  ambiguous: 'needs_attention',
  not_provisioned: 'requires_provider_approval',
});

function catalogueError() {
  const error = new Error('Canonical integration catalogue is invalid.');
  error.code = 'INTEGRATION_CATALOGUE_INVALID';
  error.status = 503;
  return error;
}

function canonicalStatusMap(canonicalStatuses) {
  if (!canonicalStatuses || canonicalStatuses.authority !== 'canonical_integration_ownership' ||
      !Array.isArray(canonicalStatuses.connectors) || canonicalStatuses.connectors.length !== 2) {
    throw catalogueError();
  }
  const projected = Object.create(null);
  canonicalStatuses.connectors.forEach(connector => {
    if (!connector || !['retell', 'voice'].includes(connector.provider) ||
        !Object.prototype.hasOwnProperty.call(OWNERSHIP_PRESENTATION, connector.status) ||
        projected[connector.provider]) {
      throw catalogueError();
    }
    projected[connector.provider] = connector.status;
  });
  if (!projected.retell || !projected.voice) throw catalogueError();
  return projected;
}

function presentation(state) {
  if (!Object.prototype.hasOwnProperty.call(PRESENTATION_LABELS, state)) throw catalogueError();
  return { state, label: PRESENTATION_LABELS[state] };
}

function projectProvider(definition, ownershipStatuses) {
  const authorityStatus = definition.dynamicProvider
    ? ownershipStatuses[definition.dynamicProvider]
    : null;
  const presentationState = authorityStatus
    ? OWNERSHIP_PRESENTATION[authorityStatus]
    : (definition.presentationState || 'coming_soon');
  return {
    key: definition.key,
    name: definition.name,
    mark: definition.mark,
    description: definition.description,
    presentation: presentation(presentationState),
    authority: {
      configuration: definition.configuration || 'authority_missing',
      connection: definition.connection || 'authority_missing',
      basis: authorityStatus || definition.basis,
    },
    capabilities: { ...UNAVAILABLE_CAPABILITIES },
  };
}

function projectIntegrationCatalogue(canonicalStatuses) {
  const ownershipStatuses = canonicalStatusMap(canonicalStatuses);
  return deepFreeze({
    authority: CATALOGUE_AUTHORITY,
    version: CATALOGUE_VERSION,
    readOnly: true,
    categories: CATEGORY_DEFINITIONS.map(category => ({
      key: category.key,
      label: category.label,
      providers: category.providers.map(provider => projectProvider(provider, ownershipStatuses)),
    })),
  });
}

async function readIntegrationCatalogue(pool, organizationId, options = {}) {
  const readStatuses = typeof options.readStatuses === 'function'
    ? options.readStatuses
    : readCanonicalIntegrationStatuses;
  const canonicalStatuses = await readStatuses(pool, organizationId);
  return projectIntegrationCatalogue(canonicalStatuses);
}

module.exports = {
  CATALOGUE_AUTHORITY,
  CATALOGUE_VERSION,
  CATEGORY_KEYS,
  PRESENTATION_STATES,
  PROVIDER_KEYS,
  projectIntegrationCatalogue,
  readIntegrationCatalogue,
};
