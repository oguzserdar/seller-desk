import type { LearningAnalysis } from "@/lib/learning-review";
import { ensureConversation } from "@/server/ai/conversation";
import { draftLearningReview } from "@/server/ai/learning-review";
import {
  pauseProcedure,
  procedureHistory,
  publishedProceduresForBuyer,
  publishProcedure,
  restoreProcedure,
  saveProcedure,
} from "@/server/domain/assistant-procedures";
import { saveLearningDraft } from "@/server/domain/learning-draft";
import {
  claimLearningPreview,
  failLearningPreview,
  listLearningPreviews,
} from "@/server/domain/learning-preview";
import { publishLearningFinding } from "@/server/domain/learning-publication";
import {
  claimLearningReview,
  learningSource,
  learningWorkspace,
  releaseLearningClaim,
  saveLearningReview,
} from "@/server/domain/learning-review";
import {
  claimProcedurePreview,
  failProcedurePreview,
  listProcedurePreviews,
} from "@/server/domain/procedure-preview";
import { answerQuestion, askSeller } from "@/server/domain/seller-questions";
import {
  approvedDestination,
  guideHistory,
  readShopGuide,
  removeGuide,
  restoreGuideVersion,
  saveGuide,
} from "@/server/domain/shop-guide";
import { withD1Database } from "@/server/request-scope";
import { createD1Db } from "@/server/storage/d1/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";

// Structured analysis is labeled storage-fixture input, not model or conversation
// evidence. These tests never synthesize a successful live AI response.
for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: shared private learning and publication boundaries`, () => {
    let f: StorageFixture;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
    });
    afterEach(async () => {
      await f?.close();
    });
    function run<T>(work: () => Promise<T>): Promise<T> {
      return f.binding ? withD1Database(createD1Db(f.binding), work) : work();
    }
    const content = {
      title: "Collection questions",
      whenToUse: "When a customer asks about collection",
      steps:
        "Read the published shop facts and ask the seller when the facts do not answer the question.",
    };
    const guide = {
      title: "Collection hours",
      topic: "general" as const,
      body: "Normal pickup ends at 6pm Edmonton time.",
      published: true,
      productId: null,
      validUntil: null,
      actionLabel: "",
      actionUrl: "",
    };
    async function answer() {
      await run(() => ensureConversation(f.buyer));
      const saved = await run(() =>
        askSeller(f.buyer, {
          question: "Can I collect at 8pm?",
          customerGoal: "Collect after work",
          knownFacts: [],
        }),
      );
      await run(() =>
        answerQuestion(f.owner, {
          questionId: saved.question.id,
          expectedRevision: 1,
          answer:
            "For this customer only, 8pm is fine. Normal pickup ends at 6pm Edmonton time.",
        }),
      );
      return run(() => learningSource(f.owner, saved.question.id));
    }
    async function review() {
      const source = await answer(),
        claimed = await run(() => claimLearningReview(f.owner, source));
      if (claimed.state !== "claimed") throw new Error("fresh claim required");
      const common = {
        explanation: "Storage boundary fixture",
        scope: "Pickup",
        questions: [],
        conflictingPolicyFields: [],
        conflictingProductIds: [],
        conflictingGuideIds: [],
        coveredByGuideIds: [],
      };
      const analysis: LearningAnalysis = {
        summary: "Storage acceptance fixture, not live AI analysis",
        findings: [
          {
            ...common,
            kind: "customer_exception",
            title: "Private late collection",
            answerQuote: "For this customer only, 8pm is fine.",
            proposedFact: null,
          },
          {
            ...common,
            kind: "reusable_fact",
            title: "Normal collection hours",
            answerQuote: guide.body,
            proposedFact: guide.body,
          },
        ],
      };
      const row = await run(() =>
        saveLearningReview(
          f.owner,
          source,
          analysis,
          "storage-acceptance-fixture-not-live-ai",
          claimed.claim,
        ),
      );
      const input = {
        reviewId: row.id,
        expectedRevision: row.revision,
        findingIndex: 1,
        title: guide.title,
        body: guide.body,
        topic: guide.topic,
        productId: null,
        validUntil: null,
        confirmReusable: true as const,
        clarification: "",
        conflicts: [],
      };
      return { source, row, input, analysis, claim: claimed.claim };
    }
    it("keeps edited instruction drafts private, preserves versions and requires exact explicit publication", async () => {
      const id = crypto.randomUUID();
      await run(() =>
        saveProcedure(f.owner, { id, expectedRevision: 0, content }),
      );
      expect(await run(() => publishedProceduresForBuyer(f.buyer))).toEqual([]);
      await run(() =>
        publishProcedure(f.owner, { id, expectedRevision: 1, approve: true }),
      );
      const edited = {
        ...content,
        steps:
          "Ask the seller to confirm the details before offering a collection time to the customer.",
      };
      await run(() =>
        saveProcedure(f.owner, { id, expectedRevision: 1, content: edited }),
      );
      expect(await run(() => publishedProceduresForBuyer(f.buyer))).toEqual([
        content,
      ]);
      await expect(
        run(() =>
          publishProcedure(f.owner, { id, expectedRevision: 1, approve: true }),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      await run(() => pauseProcedure(f.owner, id, 2, true));
      expect(await run(() => publishedProceduresForBuyer(f.buyer))).toEqual([]);
      const restored = await run(() => restoreProcedure(f.owner, id, 3, 1));
      expect(restored).toMatchObject({
        revision: 4,
        publishedRevision: null,
        content,
      });
      expect(await run(() => procedureHistory(f.owner, id))).toHaveLength(4);
    });
    it("revokes old action links and restores knowledge as a new unpublished version", async () => {
      const saved = await run(() =>
        saveGuide(f.owner, {
          ...guide,
          actionLabel: "Read collection details",
          actionUrl: "https://example.com/collection",
        }),
      );
      expect(
        (await run(() => approvedDestination(f.owner.sellerId, saved.id, 1)))
          .id,
      ).toBe(saved.id);
      await run(() => removeGuide(f.owner, saved.id, 1));
      await expect(
        run(() => approvedDestination(f.owner.sellerId, saved.id, 1)),
      ).rejects.toMatchObject({ code: "not_found" });
      const restored = await run(() =>
        restoreGuideVersion(f.owner, saved.id, 2, 1),
      );
      expect(restored).toMatchObject({
        revision: 3,
        published: false,
        archived: false,
      });
      expect((await run(() => readShopGuide(f.buyer))).sources).toEqual([]);
      expect(await run(() => guideHistory(f.owner, saved.id))).toHaveLength(3);
    });
    it("keeps analysis private, refuses customer exceptions and publishes a reusable fact once", async () => {
      const { row, input } = await review();
      expect((await run(() => readShopGuide(f.buyer))).sources).toEqual([]);
      expect(
        (await run(() => learningWorkspace(f.owner)))[0]!.review,
      ).toMatchObject({ id: row.id, stale: false });
      await expect(
        run(() =>
          publishLearningFinding(f.owner, { ...input, findingIndex: 0 }),
        ),
      ).rejects.toMatchObject({ code: "invalid" });
      const published = await run(() => publishLearningFinding(f.owner, input));
      expect((await run(() => publishLearningFinding(f.owner, input))).id).toBe(
        published.id,
      );
      const sources = (await run(() => readShopGuide(f.buyer))).sources;
      expect(sources).toHaveLength(1);
      expect(sources[0]!.body).toBe(guide.body);
      expect(JSON.stringify(sources)).not.toContain("this customer only");
      await run(() =>
        saveGuide(f.owner, {
          ...guide,
          id: published.guideId,
          expectedRevision: 1,
          body: "New collection hours end at 5pm Edmonton time.",
        }),
      );
      await run(() => publishLearningFinding(f.owner, input));
      expect(
        (await run(() => readShopGuide(f.buyer))).sources[0]!.body,
      ).toContain("5pm");
      expect(
        Number(
          (await f.query("select count(*) n from learning_publication"))[0]!.n,
        ),
      ).toBe(1);
    });
    it("rejects stale source facts and fences expired review generations", async () => {
      const source = await answer(),
        first = await run(() => claimLearningReview(f.owner, source));
      if (first.state !== "claimed") throw new Error("claim required");
      await f.query(
        "update seller_question set review_claim_expires_at=? where id=?",
        [new Date(Date.now() - 1000), source.questionId],
      );
      const next = await run(() => claimLearningReview(f.owner, source));
      if (next.state !== "claimed")
        throw new Error("replacement claim required");
      await run(() => releaseLearningClaim(f.owner, first.claim));
      const empty = { summary: "Storage fixture only", findings: [] };
      await expect(
        run(() =>
          saveLearningReview(
            f.owner,
            source,
            empty,
            "storage-fixture",
            first.claim,
          ),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      await run(() => saveGuide(f.owner, guide));
      await expect(
        run(() =>
          saveLearningReview(
            f.owner,
            source,
            empty,
            "storage-fixture",
            next.claim,
          ),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(
        Number((await f.query("select count(*) n from learning_review"))[0]!.n),
      ).toBe(0);
    });
    it("retains failed previews and exact retry identity without inventing an answer", async () => {
      const { row, input } = await review();
      const draft = {
        findingIndex: 1,
        title: input.title,
        body: input.body,
        topic: input.topic,
        productId: null,
        validUntil: null,
        clarification: "",
        conflicts: [],
      };
      const edited = await run(() =>
        saveLearningDraft(f.owner, {
          reviewId: row.id,
          expectedRevision: 1,
          draft,
        }),
      );
      const request = {
        requestId: crypto.randomUUID(),
        reviewId: row.id,
        expectedRevision: edited.revision,
        findingIndex: 1,
        question: "When does normal pickup finish?",
      };
      const preview = await run(() =>
        claimLearningPreview(
          f.owner,
          request,
          "storage-fixture-no-model-invoked",
        ),
      );
      expect(preview.created).toBe(true);
      expect(
        (
          await run(() =>
            claimLearningPreview(f.owner, request, "ignored-on-exact-retry"),
          )
        ).created,
      ).toBe(false);
      await run(() => failLearningPreview(f.owner, request.requestId));
      const views = await run(() => listLearningPreviews(f.owner));
      expect(views[0]).toMatchObject({
        state: "failed",
        current: null,
        proposed: null,
      });
      const id = crypto.randomUUID();
      await run(() =>
        saveProcedure(f.owner, { id, expectedRevision: 0, content }),
      );
      const trial = {
        requestId: crypto.randomUUID(),
        procedureId: id,
        expectedRevision: 1,
        question: "How should collection questions be handled?",
      };
      await run(() =>
        claimProcedurePreview(
          f.owner,
          trial,
          "storage-fixture-no-model-invoked",
        ),
      );
      await run(() => failProcedurePreview(f.owner, trial.requestId));
      expect(
        (await run(() => listProcedurePreviews(f.owner)))[0],
      ).toMatchObject({ state: "failed", current: null, proposed: null });
      expect((await run(() => readShopGuide(f.buyer))).sources).toEqual([]);
      expect(
        Number((await f.query("select count(*) n from orders"))[0]!.n),
      ).toBe(0);
    });
    it("leaves no fabricated review when no provider key exists", async () => {
      const source = await answer();
      await expect(
        run(() => draftLearningReview(f.owner, source.questionId)),
      ).rejects.toMatchObject({ code: "unavailable" });
      expect(
        Number((await f.query("select count(*) n from learning_review"))[0]!.n),
      ).toBe(0);
    });
  });
