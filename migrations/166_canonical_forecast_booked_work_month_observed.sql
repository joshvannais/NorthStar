-- Mission 26 Part 6A: bounded, current observed confirmations in one UTC month.
-- This is deliberately not complete monthly booked-work coverage or a forecast.
CREATE INDEX canonical_forecast_booked_work_confirmed_month
 ON public.canonical_forecast_booked_work_confirmations
 (organization_id,confirmed_at,id);

CREATE FUNCTION public.canonical_forecast_booked_work_month_observed(
 org UUID,actor UUID,role_value TEXT,session_value UUID,month_value TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE month_start TIMESTAMPTZ;month_end TIMESTAMPTZ;
 item RECORD;current_value JSONB;seen INTEGER:=0;current_count INTEGER:=0;
 amount NUMERIC(20,2):=0;currency_value TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR
   month_value IS NULL OR month_value !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR
   substring(month_value,1,4)::integer=0 THEN
  RAISE EXCEPTION 'Booked-work month invalid' USING ERRCODE='22023';
 END IF;
 month_start:=make_date(substring(month_value,1,4)::integer,
  substring(month_value,6,2)::integer,1)::timestamp AT TIME ZONE 'UTC';
 -- Calculate both boundaries in UTC rather than applying a calendar month
 -- to timestamptz in the connection's local time zone across DST.
 month_end:=(make_date(substring(month_value,1,4)::integer,
  substring(month_value,6,2)::integer,1)+INTERVAL '1 month')::timestamp
  AT TIME ZONE 'UTC';
 PERFORM public.canonical_forecast_booking_ordered_access(
  org,actor,role_value,session_value,NULL,FALSE);
 -- The confirmation writer holds this same tenant lock through commit.
 IF NOT pg_try_advisory_xact_lock(hashtextextended(
  'm26:commercial-booking-order:'||org::text,0)) THEN
  RAISE EXCEPTION 'Commercial booking source is busy' USING ERRCODE='55P03';
 END IF;
 FOR item IN
  SELECT id FROM public.canonical_forecast_booked_work_confirmations
  WHERE organization_id=org AND confirmed_at>=month_start AND confirmed_at<month_end
  ORDER BY confirmed_at,id LIMIT 101
 LOOP
  seen:=seen+1;
  IF seen>100 THEN
   RETURN jsonb_build_object('state','booked_work_month_unavailable',
    'reason','cohort_exceeds_review_limit','month',month_value,
    'completePeriodVerified',FALSE,'forecastIssued',FALSE);
  END IF;
  current_value:=public.canonical_forecast_booked_work_confirmation_currentness(
   org,actor,role_value,session_value,item.id);
  IF current_value->>'state'<>'owner_confirmed_booked_work_current' OR
    current_value->'bookedWorkVerified' IS DISTINCT FROM 'true'::jsonb OR
    current_value->>'priceBeforeTax' !~
      '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' OR
    current_value->>'currency' !~ '^[A-Z]{3}$' THEN
   RETURN jsonb_build_object('state','booked_work_month_unavailable',
    'reason','confirmation_changed_or_unavailable','month',month_value,
    'completePeriodVerified',FALSE,'forecastIssued',FALSE);
  END IF;
  IF currency_value IS NULL THEN currency_value:=current_value->>'currency';
  ELSIF currency_value<>current_value->>'currency' THEN
   RETURN jsonb_build_object('state','booked_work_month_unavailable',
    'reason','mixed_currency','month',month_value,
    'completePeriodVerified',FALSE,'forecastIssued',FALSE);
  END IF;
  amount:=amount+(current_value->>'priceBeforeTax')::numeric;
  current_count:=current_count+1;
 END LOOP;
 IF current_count=0 OR amount>999999999999999.99 THEN
  RETURN jsonb_build_object('state','booked_work_month_unavailable',
   'reason',CASE WHEN current_count=0 THEN 'no_confirmed_jobs'
    ELSE 'observed_amount_exceeds_limit' END,'month',month_value,
   'completePeriodVerified',FALSE,'forecastIssued',FALSE);
 END IF;
 RETURN jsonb_build_object('state','observed_owner_confirmed_jobs',
  'month',month_value,'timeZone','UTC','confirmedJobCount',current_count,
  'observedBeforeTax',amount::text,'currency',currency_value,
  'includedJobConfirmationsVerified',TRUE,'completePeriodVerified',FALSE,
  'wholeBusinessCoverageVerified',FALSE,'earnedRevenueMeasured',FALSE,
  'collectedCashMeasured',FALSE,'forecastIssued',FALSE);
END $$;
REVOKE ALL ON FUNCTION public.canonical_forecast_booked_work_month_observed(
 UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='northstar_app_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.canonical_forecast_booked_work_month_observed(
  UUID,UUID,TEXT,UUID,TEXT) TO northstar_app_runtime;
END IF;END $$;
