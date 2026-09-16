SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

LOCK TABLE public.demo_command_center_sessions IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.demo_command_center_sessions
  DROP CONSTRAINT demo_command_center_sessions_state_check;

ALTER TABLE public.demo_command_center_sessions
  ADD CONSTRAINT demo_command_center_sessions_state_check
  CHECK (
    jsonb_typeof(state) = 'object'
    AND octet_length(state::text) <= 2097152
  ) NOT VALID;

ALTER TABLE public.demo_command_center_sessions
  VALIDATE CONSTRAINT demo_command_center_sessions_state_check;
