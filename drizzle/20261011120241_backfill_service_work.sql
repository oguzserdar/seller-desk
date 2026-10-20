-- Existing paid services still need delivery even when their time was confirmed.
-- Preserve every prior task and commerce record. A shop must explicitly record delivery.
INSERT INTO "fulfillment_task" ("order_id", "type", "state")
SELECT "id", 'service_work', 'pending'
FROM "orders"
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements("snapshot"->'lines') AS line
  WHERE line->>'kind' = 'service'
)
ON CONFLICT ("order_id", "type") DO NOTHING;
