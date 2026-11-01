-- Custom migration: behaviour that cannot be expressed in the Drizzle schema.

-- 1. Keep updated_at current on every UPDATE, whichever code path performs it.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON "projects"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 2. Documents nest one level deep only (act -> chapter or scene).
CREATE FUNCTION enforce_document_max_depth() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM documents WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'documents can be nested only one level deep'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM documents WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'a document that has children cannot be given a parent'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER documents_enforce_max_depth
  BEFORE INSERT OR UPDATE OF parent_id ON "documents"
  FOR EACH ROW EXECUTE FUNCTION enforce_document_max_depth();
