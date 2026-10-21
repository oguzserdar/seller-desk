/**
 * Opt-in live evals for learned answers: a question the shop could not answer
 * goes to the owner; once the owner's answer is published as shop knowledge, the
 * same question is answered without asking again. A case is kept only if it
 * separates the two states, graded on the stored seller questions.
 * Skipped unless EVAL_LIVE=1 and EVAL_ANTHROPIC_API_KEY are set; each run costs cents.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROVIDER_FACTORIES } from "@/server/ai/registry";
import { newStorageFixture, type StorageFixture } from "../support/storage-fixture";
import { runBuyerTurn } from "../support/eval-shop";

const live = process.env.EVAL_LIVE === "1" && Boolean(process.env.EVAL_ANTHROPIC_API_KEY);
const model = () => PROVIDER_FACTORIES.anthropic(process.env.EVAL_ANTHROPIC_API_KEY!, process.env.EVAL_MODEL_ID ?? "claude-sonnet-5-5");

/** Each case is a buyer question and the owner's answer, published as shop knowledge. */
const CASES = [
  { question: "Are you open on Sundays? I can only come in then.", title: "Sunday hours", body: "We are closed on Sundays. The shop is open Monday to Saturday, 9am to 6pm." },
];

let f: StorageFixture;
beforeEach(async () => { if (live) f = await newStorageFixture("d1"); });
afterEach(async () => { await f?.close(); });

const sellerQuestions = async () => Number((await f.query("SELECT count(*) AS n FROM seller_question"))[0]!.n);

describe.skipIf(!live)("live model: a published owner answer replaces asking the owner", () => {
  for (const c of CASES)
    it(`${c.title}: asks the owner before, answers from shop knowledge after`, async () => {
      await runBuyerTurn(f, model(), c.question);
      const before = await sellerQuestions();
      await f.query("INSERT INTO shop_guide(id,seller_id,title,topic,body,published) VALUES (?,?,?,?,?,1)", [crypto.randomUUID(), f.owner.sellerId, c.title, "general", c.body]);
      await f.query("DELETE FROM seller_question");
      await runBuyerTurn(f, model(), c.question);
      const after = await sellerQuestions();
      expect({ before, after }).toEqual({ before: 1, after: 0 });
    }, 240_000);
});
