-- M1: one-time codes remember who asked, and their attempt count stays bounded.
--
-- requested_ip_hash holds an HMAC of the client address (never the address), so the
-- per-address request limit can count recent requests. It is NULL for rows written
-- before this column existed and where no address was known.
ALTER TABLE "otp_codes" ADD COLUMN "requested_ip_hash" TEXT;

-- The two request-limit queries read the last hour of rows for one phone or one address.
CREATE INDEX "otp_codes_phone_created_at_idx" ON "otp_codes"("phone", "created_at");

CREATE INDEX "otp_codes_requested_ip_hash_created_at_idx" ON "otp_codes"("requested_ip_hash", "created_at");

-- The service limits attempts to 5 with an atomic UPDATE. This CHECK is the backstop:
-- even a bug or a direct write cannot make the count negative or run away.
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_attempts_bounded" CHECK ("attempts" >= 0 AND "attempts" <= 100);
