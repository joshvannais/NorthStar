-- Mission 20 Phase 6D - canonical tenant and user map-launch preferences.
-- This authority records preference metadata only. It creates no provider
-- connection, credential, URL, navigation action, or external request.

CREATE TABLE organization_map_preferences (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  google_maps_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  google_maps_visible BOOLEAN NOT NULL DEFAULT TRUE,
  apple_maps_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  apple_maps_visible BOOLEAN NOT NULL DEFAULT TRUE,
  waze_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  waze_visible BOOLEAN NOT NULL DEFAULT TRUE,
  default_provider VARCHAR(32) NOT NULL DEFAULT 'google_maps',
  version BIGINT NOT NULL DEFAULT 1,
  authority_source VARCHAR(24) NOT NULL DEFAULT 'system_default',
  updated_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_map_preferences_actor_fk
    FOREIGN KEY (organization_id, updated_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT organization_map_preferences_version_check CHECK (version >= 1),
  CONSTRAINT organization_map_preferences_source_check CHECK (
    (authority_source = 'system_default' AND updated_by_user_id IS NULL)
    OR (authority_source = 'user' AND updated_by_user_id IS NOT NULL)
  ),
  CONSTRAINT organization_map_preferences_enabled_check CHECK (
    google_maps_enabled OR apple_maps_enabled OR waze_enabled
  ),
  CONSTRAINT organization_map_preferences_default_check CHECK (
    (default_provider = 'google_maps' AND google_maps_enabled)
    OR (default_provider = 'apple_maps' AND apple_maps_enabled)
    OR (default_provider = 'waze' AND waze_enabled)
  )
);
INSERT INTO organization_map_preferences (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

CREATE FUNCTION canonical_map_preferences_seed_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.organization_map_preferences (organization_id)
  VALUES (NEW.id)
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER canonical_map_preferences_seed_organization_trigger
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION canonical_map_preferences_seed_organization();

CREATE TABLE user_map_preferences (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  mode VARCHAR(16) NOT NULL,
  google_maps_enabled BOOLEAN,
  google_maps_visible BOOLEAN,
  apple_maps_enabled BOOLEAN,
  apple_maps_visible BOOLEAN,
  waze_enabled BOOLEAN,
  waze_visible BOOLEAN,
  default_provider VARCHAR(32),
  version BIGINT NOT NULL DEFAULT 1,
  updated_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_map_preferences_primary PRIMARY KEY (organization_id, user_id),
  CONSTRAINT user_map_preferences_user_fk
    FOREIGN KEY (organization_id, user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT user_map_preferences_actor_fk
    FOREIGN KEY (organization_id, updated_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT user_map_preferences_self_actor_check CHECK (updated_by_user_id = user_id),
  CONSTRAINT user_map_preferences_version_check CHECK (version >= 1),
  CONSTRAINT user_map_preferences_mode_check CHECK (mode IN ('inherit', 'override')),
  CONSTRAINT user_map_preferences_document_check CHECK (
    (
      mode = 'inherit'
      AND google_maps_enabled IS NULL AND google_maps_visible IS NULL
      AND apple_maps_enabled IS NULL AND apple_maps_visible IS NULL
      AND waze_enabled IS NULL AND waze_visible IS NULL
      AND default_provider IS NULL
    )
    OR
    (
      mode = 'override'
      AND google_maps_enabled IS NOT NULL AND google_maps_visible IS NOT NULL
      AND apple_maps_enabled IS NOT NULL AND apple_maps_visible IS NOT NULL
      AND waze_enabled IS NOT NULL AND waze_visible IS NOT NULL
      AND default_provider IS NOT NULL
      AND (google_maps_enabled OR apple_maps_enabled OR waze_enabled)
      AND (
        (default_provider = 'google_maps' AND google_maps_enabled)
        OR (default_provider = 'apple_maps' AND apple_maps_enabled)
        OR (default_provider = 'waze' AND waze_enabled)
      )
    )
  )
);
