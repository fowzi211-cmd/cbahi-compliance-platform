-- LOCAL DEVELOPMENT AND CI ONLY. Production roles and passwords are provisioned by the
-- platform team through the cloud secret manager, never from this file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mustamir_app') THEN
    CREATE ROLE mustamir_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mustamir_system') THEN
    CREATE ROLE mustamir_system NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER ROLE mustamir_app LOGIN PASSWORD 'mustamir_app';
ALTER ROLE mustamir_system LOGIN PASSWORD 'mustamir_system';
