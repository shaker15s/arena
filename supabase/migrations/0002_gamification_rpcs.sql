-- MASAR 3.2 — shared database helpers.
-- Security-sensitive user workflows are defined in 0005 with explicit grants.

CREATE OR REPLACE FUNCTION public.rule_num(p_key TEXT)
RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'object' THEN NULLIF(value->>'value','')::NUMERIC
    WHEN 'number' THEN (value #>> '{}')::NUMERIC
    ELSE NULL
  END
  FROM public.gamification_rules
  WHERE key=p_key
$$;

REVOKE ALL ON FUNCTION public.rule_num(TEXT) FROM PUBLIC, anon, authenticated;
