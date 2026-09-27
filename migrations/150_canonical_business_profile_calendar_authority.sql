-- Mission 26 Part 2B: preserve the exact calendar inputs that accompany each
-- append-only Business Profile version. The reporting-window reader compares
-- this stored representation with raw_profile before it trusts time-zone or
-- working-hours data. Existing profile rows are backfilled from their current
-- recorded value; this migration does not claim historical calendar coverage.

ALTER TABLE public.canonical_business_profiles
  ADD COLUMN IF NOT EXISTS calendar_authority JSONB;

UPDATE public.canonical_business_profiles
   SET calendar_authority = jsonb_build_object(
     'hours', raw_profile -> 'hours',
     'timeZone', raw_profile #> '{company,timeZone}'
   )
 WHERE calendar_authority IS NULL;

ALTER TABLE public.canonical_business_profiles
  ALTER COLUMN calendar_authority SET NOT NULL;

ALTER TABLE public.canonical_business_profiles
  DROP CONSTRAINT IF EXISTS canonical_business_profiles_calendar_authority_shape;
ALTER TABLE public.canonical_business_profiles
  ADD CONSTRAINT canonical_business_profiles_calendar_authority_shape CHECK (
    jsonb_typeof(calendar_authority) = 'object'
    AND calendar_authority ?& ARRAY['hours','timeZone']
    AND calendar_authority <@ jsonb_build_object(
      'hours', calendar_authority -> 'hours',
      'timeZone', calendar_authority -> 'timeZone'
    )
  );

CREATE OR REPLACE FUNCTION public.canonical_business_profile_calendar_authority_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  NEW.calendar_authority := jsonb_build_object(
    'hours', NEW.raw_profile -> 'hours',
    'timeZone', NEW.raw_profile #> '{company,timeZone}'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS canonical_business_profile_calendar_authority_insert
  ON public.canonical_business_profiles;
CREATE TRIGGER canonical_business_profile_calendar_authority_insert
BEFORE INSERT ON public.canonical_business_profiles
FOR EACH ROW EXECUTE FUNCTION
  public.canonical_business_profile_calendar_authority_insert();

REVOKE ALL ON FUNCTION
  public.canonical_business_profile_calendar_authority_insert() FROM PUBLIC;

