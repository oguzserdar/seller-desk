-- Existing approved content is the first known version. No older history is invented.
INSERT INTO shop_guide_version (guide_id, seller_id, revision, snapshot, created_at)
SELECT id, seller_id, revision,
  jsonb_build_object(
    'title', title, 'topic', topic, 'body', body,
    'actionLabel', coalesce(action_label, ''), 'actionUrl', coalesce(action_url, ''),
    'published', published, 'productId', product_id, 'validUntil', valid_until, 'archived', archived
  ), updated_at
FROM shop_guide
ON CONFLICT (guide_id, revision) DO NOTHING;
