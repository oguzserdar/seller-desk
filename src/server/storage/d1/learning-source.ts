import type { LearningSource } from "@/lib/learning-review";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  offer,
  seller,
  sellerQuestion,
  shopGuide,
} from "@/server/db/sqlite/schema";
import { invalid, notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { policySnapshotOf, type SellerRow } from "@/server/domain/seller";
import { and, asc, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import { ownerScope } from "./guards";

/** Native query fragments used together in each coherent learning snapshot. */
export function d1LearningFactsQueries(db: D1Db, owner: OwnerPrincipal) {
  return [
    db
      .select()
      .from(seller)
      .where(and(eq(seller.id, owner.sellerId), ownerScope(owner))),
    db
      .select({
        id: offer.id,
        revision: offer.revision,
        title: offer.title,
        description: offer.description,
        fulfillmentNote: offer.fulfillmentNote,
        serviceScope: offer.serviceScope,
        unitAmountMinor: offer.unitAmountMinor,
        currency: offer.currency,
        accessDays: offer.accessDays,
      })
      .from(offer)
      .where(
        and(
          eq(offer.sellerId, owner.sellerId),
          eq(offer.published, true),
          ownerScope(owner),
        ),
      )
      .orderBy(asc(offer.id))
      .limit(41),
    db
      .select({
        id: shopGuide.id,
        revision: shopGuide.revision,
        title: shopGuide.title,
        body: shopGuide.body,
        topic: shopGuide.topic,
        productId: shopGuide.productId,
        validUntil: shopGuide.validUntil,
      })
      .from(shopGuide)
      .where(
        and(
          eq(shopGuide.sellerId, owner.sellerId),
          eq(shopGuide.published, true),
          eq(shopGuide.archived, false),
          sql`(${shopGuide.validUntil} is null or ${shopGuide.validUntil}>${nowMilliseconds})`,
          ownerScope(owner),
        ),
      )
      .orderBy(asc(shopGuide.id)),
  ] as const;
}

/** Normalizes only allowlisted published data; credentials and private files never enter a review. */
export function d1LearningFacts(
  shop: SellerRow,
  products: LearningSource["products"],
  guides: {
    id: string;
    revision: number;
    title: string;
    body: string;
    topic: LearningSource["guides"][number]["topic"];
    productId: string | null;
    validUntil: Date | null;
  }[],
): Pick<LearningSource, "terms" | "products" | "guides"> {
  if (products.length > 40)
    throw invalid(
      "Answer reviews currently support up to 40 published products.",
    );
  return {
    terms: policySnapshotOf(shop),
    products,
    guides: guides.map((guide) => ({
      ...guide,
      validUntil: guide.validUntil?.toISOString() ?? null,
    })),
  };
}

/** Rechecks the complete published set inside a mutating D1 batch, including additions and expiry. */
export function d1LearningFactsGuard(
  owner: OwnerPrincipal,
  facts: Pick<LearningSource, "terms" | "products" | "guides">,
) {
  const guides = facts.guides.map((guide) => ({
    ...guide,
    validUntil: guide.validUntil ? new Date(guide.validUntil).getTime() : null,
  }));
  return sql`${ownerScope(owner)} and exists(select 1 from seller s where s.id=${owner.sellerId}
    and json_object('policyRevision',s.policy_revision,'sellerName',s.display_name,'pickupPolicy',s.pickup_policy,'serviceRequestPolicy',s.service_request_policy,'digitalAccessPolicy',s.digital_access_policy,'cancellationPolicy',s.cancellation_policy,'taxPolicy',s.tax_policy)=json(${JSON.stringify(facts.terms)}))
    and (select count(*) from offer where seller_id=${owner.sellerId} and published=1)=${facts.products.length}
    and not exists(select 1 from json_each(${JSON.stringify(facts.products)}) e left join offer o on o.id=json_extract(e.value,'$.id') and o.seller_id=${owner.sellerId} and o.published=1
      where o.id is null or o.revision is not json_extract(e.value,'$.revision') or o.title is not json_extract(e.value,'$.title') or o.description is not json_extract(e.value,'$.description') or o.fulfillment_note is not json_extract(e.value,'$.fulfillmentNote') or o.service_scope is not json_extract(e.value,'$.serviceScope') or o.unit_amount_minor is not json_extract(e.value,'$.unitAmountMinor') or o.currency is not json_extract(e.value,'$.currency') or o.access_days is not json_extract(e.value,'$.accessDays'))
    and (select count(*) from shop_guide where seller_id=${owner.sellerId} and published=1 and archived=0 and (valid_until is null or valid_until>${nowMilliseconds}))=${guides.length}
    and not exists(select 1 from json_each(${JSON.stringify(guides)}) e left join shop_guide g on g.id=json_extract(e.value,'$.id') and g.seller_id=${owner.sellerId} and g.published=1 and g.archived=0
      where g.id is null or g.revision is not json_extract(e.value,'$.revision') or g.title is not json_extract(e.value,'$.title') or g.body is not json_extract(e.value,'$.body') or g.topic is not json_extract(e.value,'$.topic') or g.product_id is not json_extract(e.value,'$.productId') or g.valid_until is not json_extract(e.value,'$.validUntil') or (g.valid_until is not null and g.valid_until<=${nowMilliseconds}))`;
}

/** Rechecks the private answer as well as every public fact used during model generation. */
export function d1LearningSourceGuard(
  owner: OwnerPrincipal,
  source: LearningSource,
) {
  return sql`${d1LearningFactsGuard(owner, source)} and exists(select 1 from seller_question where id=${source.questionId} and seller_id=${owner.sellerId} and revision=${source.sourceRevision} and question=${source.question} and customer_goal=${source.customerGoal} and known_facts=${JSON.stringify(source.knownFacts)} and answer=${source.answer} and state<>'open')`;
}

/** Captures the owner and learning source in one real native D1 read batch. */
export async function captureD1LearningSource(
  db: D1Db,
  owner: OwnerPrincipal,
  id: string,
) {
  const [shops, products, guides, answers] = await db.batch([
    ...d1LearningFactsQueries(db, owner),
    db
      .select()
      .from(sellerQuestion)
      .where(
        and(
          eq(sellerQuestion.id, id),
          eq(sellerQuestion.sellerId, owner.sellerId),
          ownerScope(owner),
        ),
      ),
  ]);
  const shop = shops[0];
  if (!shop) throw notFound("shop");
  const answer = answers[0];
  if (!answer) throw notFound("seller answer");
  if (!answer.answer || answer.state === "open")
    throw invalid(
      "Answer this customer's question before reviewing what the assistant can learn.",
    );
  const source: LearningSource = {
    questionId: answer.id,
    sourceRevision: answer.revision,
    question: answer.question,
    customerGoal: answer.customerGoal,
    knownFacts: answer.knownFacts,
    answer: answer.answer,
    ...d1LearningFacts(shop, products, guides),
  };
  return { shop, source, guard: d1LearningSourceGuard(owner, source) };
}
