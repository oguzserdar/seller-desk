"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { ownerAction } from "@/server/actions/safe-action";
import { resumeAfterAnswer } from "@/server/ai/resume";
import { draftLearningReview } from "@/server/ai/learning-review";
import { draftOwnerReply } from "@/server/ai/owner-reply";
import { retryAccess } from "@/server/domain/digital";
import { CompletePickupInput, completePickup, recordServiceFollowUp, ServiceFollowUpInput } from "@/server/domain/orders";
import { DecideInput, decideProposal } from "@/server/domain/proposals";
import { approveQuoteScope, declineQuote, ServiceQuoteReview } from "@/server/domain/quotes";
import { answerQuestion } from "@/server/domain/seller-questions";
import { CompleteServiceWorkInput, completeServiceWork } from "@/server/domain/service-work";
import { reconcilePayment } from "@/server/payments/engine";
import { ReplyOrderFollowupInput } from "@/lib/order-followup";
import { replyOrderFollowup } from "@/server/domain/order-followup";

/** Sends the authenticated seller's reply without claiming customer resolution. */
export const replyOrderHelpAction = ownerAction.inputSchema(ReplyOrderFollowupInput).action(async ({ parsedInput, ctx }) => {
  const view = await replyOrderFollowup(ctx.owner, parsedInput);
  revalidatePath("/owner", "layout");
  return view;
});

export const completePickupAction = ownerAction.inputSchema(CompletePickupInput).action(async ({ parsedInput, ctx }) => {
  const task = await completePickup(ctx.owner, parsedInput);
  revalidatePath("/owner", "layout");
  return { state: task.state, revision: task.revision };
});

export const serviceFollowUpAction = ownerAction.inputSchema(ServiceFollowUpInput).action(async ({ parsedInput, ctx }) => {
  const task = await recordServiceFollowUp(ctx.owner, parsedInput);
  revalidatePath("/owner", "layout");
  return { state: task.state, revision: task.revision };
});

/** Records work explicitly completed by this authenticated seller. */
export const completeServiceWorkAction = ownerAction.inputSchema(CompleteServiceWorkInput).action(async ({ parsedInput, ctx }) => {
  const task = await completeServiceWork(ctx.owner, parsedInput);
  revalidatePath("/owner", "layout");
  return { state: task.state, revision: task.revision };
});

export const retryAccessAction = ownerAction.inputSchema(z.object({ orderId: z.uuid() }).strict()).action(async ({ parsedInput, ctx }) => {
  const outcome = await retryAccess(ctx.owner, parsedInput.orderId);
  revalidatePath("/owner", "layout");
  return outcome;
});

export const reconcilePaymentAction = ownerAction.inputSchema(z.object({ attemptId: z.uuid() }).strict()).action(async ({ parsedInput, ctx }) => {
  const view = await reconcilePayment(ctx.owner, parsedInput.attemptId, { mayCapture: true });
  revalidatePath("/owner", "layout");
  return view;
});

export const approveScopeAction = ownerAction
  .inputSchema(ServiceQuoteReview)
  .action(async ({ parsedInput, ctx }) => {
    const created = await approveQuoteScope(ctx.owner, parsedInput);
    const questionId = parsedInput.answer?.questionId;
    if (questionId) after(() => resumeAfterAnswer(questionId));
    revalidatePath("/owner", "layout");
    return { quoteId: created.id, revision: created.revision, status: created.status };
  });

export const declineQuoteAction = ownerAction
  .inputSchema(z.object({ quoteId: z.uuid(), expectedRevision: z.number().int().min(1), reason: z.string().trim().min(3).max(500) }).strict())
  .action(async ({ parsedInput, ctx }) => {
    const updated = await declineQuote(ctx.owner, parsedInput);
    revalidatePath("/owner", "layout");
    return { status: updated.status };
  });

export const decideProposalAction = ownerAction.inputSchema(DecideInput).action(async ({ parsedInput, ctx }) => {
  const decision = await decideProposal(ctx.owner, parsedInput);
  revalidatePath("/owner", "layout");
  return decision;
});

export const answerQuestionAction = ownerAction
  .inputSchema(z.object({ questionId: z.uuid(), expectedRevision: z.number().int().min(1), answer: z.string().trim().min(1).max(1000) }).strict())
  .action(async ({ parsedInput, ctx }) => {
    const answered = await answerQuestion(ctx.owner, parsedInput);
    // The customer's conversation continues after this response is sent; if that run fails, the job runner retries it.
    after(() => resumeAfterAnswer(answered.id));
    // Like a support team's knowledge drafts: the answer is drafted as shop knowledge for the owner to
    // approve, so the next customer can get it from the assistant. A failed draft leaves the answer sent.
    after(() => draftLearningReview(ctx.owner, answered.id).catch(() => undefined));
    revalidatePath("/owner", "layout");
    return { state: answered.state };
  });

/** Drafts a reply to a waiting question from the shop's own facts; the owner reads and sends it. */
export const draftReplyAction = ownerAction
  .inputSchema(z.object({ questionId: z.uuid() }).strict())
  .action(async ({ parsedInput, ctx }) => draftOwnerReply(ctx.owner, parsedInput.questionId));
