import { getCurrentBuyerQuote } from "@/server/domain/current-quote";
import * as catalog from "@/server/domain/offers";
import * as quotes from "@/server/domain/quotes";
import * as seller from "@/server/domain/seller";
import * as questions from "@/server/domain/seller-questions";
import { createD1CatalogReads } from "@/server/storage/d1/catalog-read";
import { createD1CatalogWrites } from "@/server/storage/d1/catalog-write";
import { createD1Db } from "@/server/storage/d1/client";
import { createD1QuoteApproval } from "@/server/storage/d1/quote-approval";
import { createD1QuoteReads } from "@/server/storage/d1/quote-view";
import { createD1QuoteWrites } from "@/server/storage/d1/quote-write";
import { createD1SellerStorage } from "@/server/storage/d1/seller";
import { createD1SellerQuestions } from "@/server/storage/d1/seller-questions";
import type { StorageFixture } from "./storage-fixture";

/** Identical acceptance calls across the native commerce implementations. */
export function commerceStorage(f: StorageFixture) {
  if (f.binding) {
    const db = createD1Db(f.binding);
    return {
      ...createD1SellerStorage(db),
      ...createD1CatalogReads(db),
      ...createD1CatalogWrites(db),
      ...createD1QuoteReads(db),
      ...createD1QuoteWrites(db),
      ...createD1QuoteApproval(db),
      ...createD1SellerQuestions(db),
    };
  }
  return {
    ...seller,
    ...catalog,
    ...quotes,
    ...questions,
    getCurrentBuyerQuote,
  };
}
