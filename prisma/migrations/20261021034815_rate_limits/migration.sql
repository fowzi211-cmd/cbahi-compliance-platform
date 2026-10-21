-- CreateTable
CREATE TABLE "rate_limit_bucket" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("key")
);

-- ---------------------------------------------------------------------------
-- Hand-written: the app's own rate limits (M16).
-- ---------------------------------------------------------------------------

-- Keys name a person or an address, not a tenant, so there is no RLS policy. Instead the app
-- role has no access to the table at all and goes through the function below, which can only
-- count: it cannot read other keys, reset a counter or delete one.
REVOKE ALL ON "rate_limit_bucket" FROM mustamir_app;

-- Counts one hit on `p_key` in the current fixed window of `p_window_seconds` and says whether
-- it is within `p_max`, and if not, how many seconds until the window ends. One statement, so
-- two requests at once cannot both slip under the limit.
CREATE FUNCTION app_rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
  RETURNS TABLE (allowed boolean, retry_after_seconds integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  w timestamptz := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / p_window_seconds)
                                * p_window_seconds);
  n integer;
BEGIN
  IF p_window_seconds <= 0 OR p_max <= 0 OR length(p_key) > 200 THEN
    RAISE EXCEPTION 'invalid rate limit' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO rate_limit_bucket AS b (key, window_start, count) VALUES (p_key, w, 1)
  ON CONFLICT (key) DO UPDATE
    SET count = CASE WHEN b.window_start = EXCLUDED.window_start THEN b.count + 1 ELSE 1 END,
        window_start = EXCLUDED.window_start
  RETURNING b.count INTO n;
  RETURN QUERY SELECT n <= p_max,
    greatest(1, ceil(extract(epoch FROM (w + make_interval(secs => p_window_seconds)
                                          - clock_timestamp())))::integer);
END
$$;

ALTER FUNCTION app_rate_limit_hit(text, integer, integer) OWNER TO mustamir_system;
REVOKE ALL ON FUNCTION app_rate_limit_hit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_rate_limit_hit(text, integer, integer) TO mustamir_app;
