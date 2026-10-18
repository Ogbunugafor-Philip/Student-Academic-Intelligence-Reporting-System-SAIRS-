ALTER TABLE report_cards
  ADD COLUMN IF NOT EXISTS verification_token_hash char(64),
  ADD COLUMN IF NOT EXISTS verification_token_encrypted text;

CREATE UNIQUE INDEX IF NOT EXISTS report_cards_verification_token_hash_unique
  ON report_cards(verification_token_hash)
  WHERE verification_token_hash IS NOT NULL;

