-- Mission 20 Part 2E - tenant workforce structure and invitation authority.
-- Additive only: no schedules, assignments, field execution, assets, provider
-- ownership, or production-data inference is introduced by this migration.

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

CREATE TABLE workforce_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name VARCHAR(480) NOT NULL,
  email VARCHAR(254) NOT NULL,
  email_normalized VARCHAR(254) NOT NULL,
  phone VARCHAR(50) NOT NULL DEFAULT '',
  access_role VARCHAR(50) NOT NULL,
  operational_role VARCHAR(32) NOT NULL,
  home_location_id VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  token_hash CHAR(64) NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  delivery_generation INTEGER NOT NULL DEFAULT 1,
  accepted_membership_id UUID,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by_user_id UUID NOT NULL,
  updated_by_user_id UUID NOT NULL,
  revoked_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workforce_invitations_tenant_identity UNIQUE (organization_id, id),
  CONSTRAINT workforce_invitations_token_unique UNIQUE (token_hash),
  CONSTRAINT workforce_invitations_accepted_membership_fk
    FOREIGN KEY (organization_id, accepted_membership_id)
    REFERENCES organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT workforce_invitations_created_by_fk FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_invitations_updated_by_fk FOREIGN KEY (organization_id, updated_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_invitations_revoked_by_fk FOREIGN KEY (organization_id, revoked_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workforce_invitations_name_check CHECK (
    length(btrim(name)) BETWEEN 1 AND 120 AND octet_length(name) <= 480
  ),
  CONSTRAINT workforce_invitations_email_check CHECK (
    email = email_normalized AND email_normalized = lower(btrim(email_normalized))
    AND length(email_normalized) BETWEEN 3 AND 254
  ),
  CONSTRAINT workforce_invitations_phone_check CHECK (octet_length(phone) <= 50),
  CONSTRAINT workforce_invitations_access_role_check CHECK (access_role IN ('admin', 'member', 'viewer')),
  CONSTRAINT workforce_invitations_operational_role_check CHECK (
    operational_role IN (
      'owner', 'administrator', 'dispatcher', 'estimator', 'crew_lead',
      'technician', 'accounting', 'employee', 'other'
    )
  ),
  CONSTRAINT workforce_invitations_location_check CHECK (
    home_location_id IS NULL OR home_location_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
  ),
  CONSTRAINT workforce_invitations_status_check CHECK (status IN ('pending', 'accepted', 'revoked')),
  CONSTRAINT workforce_invitations_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT workforce_invitations_expiry_check CHECK (token_expires_at > created_at),
  CONSTRAINT workforce_invitations_generation_check CHECK (delivery_generation >= 1),
  CONSTRAINT workforce_invitations_terminal_check CHECK (
    (status = 'pending' AND accepted_membership_id IS NULL AND accepted_at IS NULL AND revoked_at IS NULL)
    OR (status = 'accepted' AND accepted_membership_id IS NOT NULL AND accepted_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND accepted_membership_id IS NULL AND accepted_at IS NULL AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX workforce_invitations_one_pending_email
  ON workforce_invitations(organization_id, email_normalized)
  WHERE status = 'pending';

CREATE INDEX workforce_invitations_organization_status
  ON workforce_invitations(organization_id, status, created_at DESC, id);

CREATE INDEX workforce_invitations_expiry
  ON workforce_invitations(token_expires_at)
  WHERE status = 'pending';

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

CREATE TABLE workforce_invitation_skills (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invitation_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workforce_invitation_skills_primary PRIMARY KEY (organization_id, invitation_id, skill_id),
  CONSTRAINT workforce_invitation_skills_invitation_fk FOREIGN KEY (organization_id, invitation_id)
    REFERENCES workforce_invitations(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT workforce_invitation_skills_skill_fk FOREIGN KEY (organization_id, skill_id)
    REFERENCES workforce_skills(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT workforce_invitation_skills_created_by_fk FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX workforce_invitation_skills_skill
  ON workforce_invitation_skills(organization_id, skill_id, invitation_id);

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
      'invitation_created', 'invitation_resent', 'invitation_revoked', 'invitation_accepted',
      'member_access_updated',
      'member_profile_updated', 'skill_created', 'skill_updated',
      'crew_created', 'crew_updated'
    )
  ),
  CONSTRAINT workforce_audit_events_subject_check CHECK (
    subject_type IN ('invitation', 'membership', 'profile', 'skill', 'crew')
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
