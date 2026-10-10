-- Hand-written (drizzle-kit cannot express DEFERRABLE). Deleting a store or company cascades to
-- both store_currency and variant_price; checked immediately, this FK fired before the cascade had
-- removed the prices and the delete failed. Deferred to commit, cascades work, while removing a
-- currency that still has prices is still rejected.
ALTER TABLE "variant_price" ALTER CONSTRAINT "variant_price_store_currency_fk" DEFERRABLE INITIALLY DEFERRED;
