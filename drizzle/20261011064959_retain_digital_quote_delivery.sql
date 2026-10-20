-- Retain only facts whose source revision still matches the reviewed quote.
-- Never guess an older file from a newer catalog revision. Existing order,
-- payment and grant rows are untouched; unresolved delivery needs the seller.
INSERT INTO digital_quote_line (quote_id, offer_id, asset_id, access_days)
SELECT q.id, o.id, o.digital_asset_id, o.access_days
FROM quote q
CROSS JOIN LATERAL jsonb_array_elements(q.lines) line
JOIN offer o ON o.id = (line->>'offerId')::uuid
  AND o.seller_id = q.seller_id
  AND o.revision = (line->>'offerRevision')::integer
JOIN digital_asset a ON a.id = o.digital_asset_id AND a.seller_id = q.seller_id
WHERE line->>'kind' = 'digital'
  AND o.kind = 'digital'
  AND o.access_days BETWEEN 1 AND 3650
ON CONFLICT (quote_id, offer_id) DO NOTHING;
