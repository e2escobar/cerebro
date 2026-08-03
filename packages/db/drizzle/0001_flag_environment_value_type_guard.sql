-- Backstop for spec §5.1 on `flag_environment.value`.
--
-- A table-level CHECK cannot reach `flag.type`, so the per-environment value is
-- guarded by a constraint trigger instead. Domain validation in packages/core is
-- what produces user-facing errors; this only stops writes that bypass it.

CREATE OR REPLACE FUNCTION assert_flag_environment_value_type() RETURNS trigger AS $$
DECLARE
  declared_type flag_type;
BEGIN
  SELECT "type" INTO declared_type FROM flag WHERE id = NEW.flag_id;

  IF declared_type IS NULL OR declared_type = 'json' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.value) <> declared_type::text THEN
    RAISE EXCEPTION
      'flag_environment.value must be a JSON % for flag %, got %',
      declared_type, NEW.flag_id, jsonb_typeof(NEW.value)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER flag_environment_value_type_guard
  BEFORE INSERT OR UPDATE OF value ON flag_environment
  FOR EACH ROW EXECUTE FUNCTION assert_flag_environment_value_type();
