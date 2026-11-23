-- Tokens without an OAuth grant were copied by hand. They no longer authenticate.
DELETE FROM access_tokens WHERE grant_id IS NULL;
