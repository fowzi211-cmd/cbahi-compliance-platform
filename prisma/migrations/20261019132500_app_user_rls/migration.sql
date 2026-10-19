-- Users are global (one person can work for several tenants). A tenant sees and edits only
-- people who hold a membership in it; the membership subquery is itself filtered by RLS.
-- Creating users (sign-up, invitations) goes through the system role.
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
CREATE POLICY member_of_current_tenant_read ON app_user FOR SELECT
  USING (EXISTS (SELECT 1 FROM membership m WHERE m.user_id = app_user.id));
CREATE POLICY member_of_current_tenant_update ON app_user FOR UPDATE
  USING (EXISTS (SELECT 1 FROM membership m WHERE m.user_id = app_user.id));
