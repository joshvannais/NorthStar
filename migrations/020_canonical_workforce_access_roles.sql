-- Mission 20 Phase 7 Lane 3: canonical access authority for legacy workforce roles.
--
-- organization_memberships remains the access-role authority. Dispatcher and
-- technician identity is already materialized separately by migration 015 in
-- workforce_profiles.operational_role, so this migration deliberately never
-- updates workforce_profiles.

UPDATE users account
   SET role = CASE
                WHEN membership.role IN ('dispatcher', 'tech') THEN 'member'
                ELSE membership.role
              END,
       updated_at = NOW()
  FROM organization_memberships membership
 WHERE membership.user_id = account.id
   AND membership.organization_id = account.organization_id
   AND (account.role IN ('dispatcher', 'tech') OR membership.role IN ('dispatcher', 'tech'))
   AND account.role IS DISTINCT FROM CASE
                                       WHEN membership.role IN ('dispatcher', 'tech') THEN 'member'
                                       ELSE membership.role
                                     END;

-- Account rows without a membership cannot authenticate, but their mirrored
-- access value must still satisfy the canonical constraint after this upgrade.
UPDATE users
   SET role = 'member',
       updated_at = NOW()
 WHERE role IN ('dispatcher', 'tech');

UPDATE organization_memberships
   SET role = 'member',
       updated_at = NOW()
 WHERE role IN ('dispatcher', 'tech');

ALTER TABLE users DROP CONSTRAINT IF EXISTS account_users_role_check;
ALTER TABLE users ADD CONSTRAINT account_users_role_check CHECK (
  role IN ('owner', 'admin', 'member', 'viewer')
);

ALTER TABLE organization_memberships DROP CONSTRAINT IF EXISTS organization_memberships_role_check;
ALTER TABLE organization_memberships ADD CONSTRAINT organization_memberships_role_check CHECK (
  role IN ('owner', 'admin', 'member', 'viewer')
);

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
      WHEN 'viewer' THEN 'other'
      ELSE 'employee'
    END,
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
