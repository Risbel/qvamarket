-- Hand-written: the new `customer:read` permission (Customers section) goes to the manager,
-- cashier and viewer roles seeded from the presets
UPDATE "company_role"
SET "permissions" = "permissions" || '{"customer": ["read"]}'::jsonb
WHERE "preset_key" IN ('manager', 'cashier', 'viewer')
  AND NOT ("permissions" ? 'customer');
