-- Security hardening.
--
-- The public.rls_auto_enable() helper was created as a SECURITY DEFINER function
-- and, by default, Postgres grants EXECUTE on new functions to PUBLIC, making it
-- callable by the anon / authenticated roles via PostgREST RPC. Revoke that
-- direct access: only server-side code (the postgres / supabase_admin roles)
-- may invoke it. Applied defensively so a fresh database that never had the
-- helper is unaffected.

DO $do$
DECLARE
  fn_oid oid := to_regprocedure('public.rls_auto_enable()');
BEGIN
  IF fn_oid IS NOT NULL THEN
    EXECUTE format(
      'ALTER FUNCTION public.rls_auto_enable() SECURITY DEFINER STABLE;'
    );
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;'
    );
  END IF;
END
$do$;