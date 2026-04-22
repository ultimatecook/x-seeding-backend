-- Store Instagram profile photo bytes directly so we're never dependent on
-- external services (unavatar.io, Instagram CDN) at display time.
ALTER TABLE "Influencer" ADD COLUMN IF NOT EXISTS "profilePicData" BYTEA;
