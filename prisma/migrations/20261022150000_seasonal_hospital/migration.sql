-- CBAHI surveys seasonal hospitals (Hajj and Umrah seasons) under their own national-standards
-- programme, so they get their own facility type. "other" stays last in the list.
INSERT INTO "facility_type" ("code", "name_ar", "name_en", "sort") VALUES
  ('seasonal_hospital', 'مستشفى موسمي', 'Seasonal hospital', 7);

UPDATE "facility_type" SET "sort" = 8 WHERE "code" = 'other';
