-- Mission 20 Part 2E - tenant workforce structure and invitation authority.
-- Additive only: no schedules, assignments, field execution, assets, provider
-- ownership, or production-data inference is introduced by this migration.

ALTER TABLE organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_status_check;
ALTER TABLE organization_memberships
  ADD CONSTRAINT organization_memberships_status_check CHECK (
    status IN ('invited', 'active', 'suspended', 'revoked')
  );

ALTER TABLE account_action_tokens
  DROP CONSTRAINT IF EXISTS account_action_tokens_purpose_check;
ALTER TABLE account_action_tokens
  ADD CONSTRAINT account_action_tokens_purpose_check CHECK (
    purpose IN ('email_verification', 'password_reset', 'membership_invitation')
  );

ALTER TABLE auth_rate_limits
  DROP CONSTRAINT IF EXISTS auth_rate_limits_event_check;
ALTER TABLE auth_rate_limits
  ADD CONSTRAINT auth_rate_limits_event_check CHECK (
    event_type IN (
      'login_ip', 'login_email', 'signup_ip', 'verification_ip',
      'verification_user', 'forgot_ip', 'reset_ip',
      'workforce_invite_ip', 'workforce_accept_ip'
    )
  );

CREATE TABLE workforce_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  membership_id UUID NOT NULL,
  operational_role VARCHAR(32) NOT NULL,
  home_location_id VARCHAR(64),
  created_by_user_id UUID,
  updated_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workforce_profiles_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT workforce_profiles_membership_unique UNIQUE (organization_id, membership_id),
  CONSTRAINT workforce_profiles_stable_membership_identity CHECK (id = membership_id),
  CONSTRAINT workforce_profiles_membership_fk FOREIGN KEY (organization_id, membership_id)
    REFERENCES organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT workforce_profiles_created_by_fk FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_profiles_updated_by_fk FOREIGN KEY (organization_id, updated_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_profiles_operational_role_check CHECK (
    operational_role IN (
      'owner', 'administrator', 'dispatcher', 'estimator', 'crew_lead',
      'technician', 'accounting', 'employee', 'other'
    )
  ),
  CONSTRAINT workforce_profiles_location_check CHECK (
    home_location_id IS NULL OR home_location_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  )
);

CREATE INDEX workforce_profiles_organization
  ON workforce_profiles(organization_id, operational_role, id);

CREATE TABLE workforce_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  skill_key VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  service_id VARCHAR(64),
  created_by_user_id UUID NOT NULL,
  updated_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workforce_skills_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT workforce_skills_created_by_fk FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_skills_updated_by_fk FOREIGN KEY (organization_id, updated_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_skills_key_check CHECK (
    skill_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  ),
  CONSTRAINT workforce_skills_name_check CHECK (
    length(btrim(name)) BETWEEN 1 AND 120
  ),
  CONSTRAINT workforce_skills_description_check CHECK (
    octet_length(description) <= 4096
  ),
  CONSTRAINT workforce_skills_service_check CHECK (
    service_id IS NULL OR service_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  )
);

CREATE UNIQUE INDEX workforce_skills_name_unique
  ON workforce_skills(organization_id, lower(btrim(name)));

CREATE UNIQUE INDEX workforce_skills_key_unique
  ON workforce_skills(organization_id, lower(skill_key));

CREATE TABLE workforce_profile_skills (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workforce_profile_skills_primary PRIMARY KEY (organization_id, profile_id, skill_id),
  CONSTRAINT workforce_profile_skills_profile_fk FOREIGN KEY (organization_id, profile_id)
    REFERENCES workforce_profiles(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT workforce_profile_skills_skill_fk FOREIGN KEY (organization_id, skill_id)
    REFERENCES workforce_skills(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT workforce_profile_skills_created_by_fk FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX workforce_profile_skills_skill
  ON workforce_profile_skills(organization_id, skill_id, profile_id);

CREATE TABLE workforce_crews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  crew_key VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  home_location_id VARCHAR(64),
  created_by_user_id UUID NOT NULL,
  updated_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workforce_crews_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT workforce_crews_created_by_fk FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_crews_updated_by_fk FOREIGN KEY (organization_id, updated_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_crews_key_check CHECK (
    crew_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  ),
  CONSTRAINT workforce_crews_name_check CHECK (
    length(btrim(name)) BETWEEN 1 AND 120
  ),
  CONSTRAINT workforce_crews_location_check CHECK (
    home_location_id IS NULL OR home_location_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  )
);

CREATE UNIQUE INDEX workforce_crews_name_unique
  ON workforce_crews(organization_id, lower(btrim(name)));

CREATE UNIQUE INDEX workforce_crews_key_unique
  ON workforce_crews(organization_id, lower(crew_key));

CREATE TABLE workforce_crew_members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  crew_id UUID NOT NULL,
  profile_id UUID NOT NULL,
  crew_role VARCHAR(16) NOT NULL DEFAULT 'member',
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workforce_crew_members_primary PRIMARY KEY (organization_id, crew_id, profile_id),
  CONSTRAINT workforce_crew_members_crew_fk FOREIGN KEY (organization_id, crew_id)
    REFERENCES workforce_crews(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT workforce_crew_members_profile_fk FOREIGN KEY (organization_id, profile_id)
    REFERENCES workforce_profiles(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT workforce_crew_members_created_by_fk FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_crew_members_role_check CHECK (crew_role IN ('lead', 'member'))
);

CREATE UNIQUE INDEX workforce_crew_members_one_lead
  ON workforce_crew_members(organization_id, crew_id)
  WHERE crew_role = 'lead';

CREATE INDEX workforce_crew_members_profile
  ON workforce_crew_members(organization_id, profile_id, crew_id);

CREATE TABLE workforce_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL,
  action VARCHAR(64) NOT NULL,
  subject_type VARCHAR(32) NOT NULL,
  subject_id UUID NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workforce_audit_events_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT workforce_audit_events_actor_fk FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_audit_events_action_check CHECK (
    action IN (
      'member_invited', 'invitation_resent', 'invitation_accepted', 'member_access_updated',
      'member_profile_updated', 'skill_created', 'skill_updated',
      'crew_created', 'crew_updated'
    )
  ),
  CONSTRAINT workforce_audit_events_subject_check CHECK (
    subject_type IN ('membership', 'profile', 'skill', 'crew')
  ),
  CONSTRAINT workforce_audit_events_details_check CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX workforce_audit_events_organization_time
  ON workforce_audit_events(organization_id, created_at DESC, id);

INSERT INTO workforce_profiles (
  id,
  organization_id,
  membership_id,
  operational_role,
  created_by_user_id,
  updated_by_user_id
)
SELECT membership.id,
       membership.organization_id,
       membership.id,
       CASE membership.role
         WHEN 'owner' THEN 'owner'
         WHEN 'admin' THEN 'administrator'
         WHEN 'dispatcher' THEN 'dispatcher'
         WHEN 'tech' THEN 'technician'
         WHEN 'viewer' THEN 'other'
         ELSE 'employee'
       END,
       NULL,
       NULL
  FROM organization_memberships membership
ON CONFLICT (organization_id, membership_id) DO NOTHING;

CREATE OR REPLACE FUNCTION workforce_create_membership_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO workforce_profiles (
    id,
    organization_id,
    membership_id,
    operational_role,
    created_by_user_id,
    updated_by_user_id
  ) VALUES (
    NEW.id,
    NEW.organization_id,
    NEW.id,
    CASE NEW.role
      WHEN 'owner' THEN 'owner'
      WHEN 'admin' THEN 'administrator'
      WHEN 'dispatcher' THEN 'dispatcher'
      WHEN 'tech' THEN 'technician'
      WHEN 'viewer' THEN 'other'
      ELSE 'employee'
    END,
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workforce_membership_profile
  AFTER INSERT ON organization_memberships
  FOR EACH ROW EXECUTE FUNCTION workforce_create_membership_profile();
