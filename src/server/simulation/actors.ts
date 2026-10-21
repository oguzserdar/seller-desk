/** Explicit fictional people, separate from model decisions and unavailable outside simulation. */
import { armFault, decideFixtureOrder } from "@/fixtures/paypal-fixture";
import { SimulationStep, type SimulationSideResult } from "@/lib/simulation";
import { openQuote } from "@/server/ai/buyer-tools";
import { getDb } from "@/server/db/client";
import {
  changeConversationHandler,
  readOwnerConversationControl,
} from "@/server/domain/conversation-control";
import {
  readSellerConversation,
  sendSellerMessage,
} from "@/server/domain/conversation-messages";
import { conflict } from "@/server/domain/errors";
import type { BuyerPrincipal } from "@/server/domain/principal";
import { approveQuoteScope } from "@/server/domain/quotes";
import { reconcilePayment, startCheckout } from "@/server/payments/engine";
import { getRequestScope } from "@/server/request-scope";
import { getStorage } from "@/server/storage";
import type { SimulationInstallation } from "./install-snapshot";

/** Executes one validated non-AI actor, recording approvals as each actual effect succeeds. */
export async function executeSimulationActor(input: {
  step: SimulationStep;
  installed: SimulationInstallation;
  buyer: BuyerPrincipal;
  conversationId: string;
  approvals: SimulationSideResult["approvals"];
}) {
  if (!getRequestScope()?.simulation)
    throw new Error("Fictional actors require an isolated simulation.");
  const step = SimulationStep.parse(input.step);
  const { installed, buyer, conversationId, approvals } = input;
  if (step.kind === "customer" || step.kind === "simulated_customer")
    throw new Error("Customer turns must run through the real assistant.");
  if (step.kind === "seller_reply") {
    const current = await readOwnerConversationControl(
      installed.owner,
      conversationId,
    );
    const control = await changeConversationHandler(installed.owner, {
      id: conversationId,
      expectedRevision: current.revision,
      handler: "seller",
    });
    const { pending } = await readSellerConversation(
      installed.owner,
      conversationId,
    );
    await sendSellerMessage(installed.owner, {
      id: crypto.randomUUID(),
      conversationId,
      expectedRevision: control.revision,
      text: step.text,
      ...(pending
        ? { answerPending: { id: pending.id, revision: pending.revision } }
        : {}),
    });
    await changeConversationHandler(installed.owner, {
      id: conversationId,
      expectedRevision: control.revision,
      handler: "assistant",
    });
    return;
  }
  const quote = await openQuote(buyer);
  if (!quote || quote.currency !== step.expected.currency)
    throw conflict(
      "The quote does not match the fictional person's selected currency.",
    );
  // A payment approves an exact amount, so it is bound before acting. A scope approval may set custom prices; its total is checked after.
  if (
    step.kind === "pay_quote" &&
    quote.totalMinor !== step.expected.totalMinor
  )
    throw conflict(
      "The quote does not match the fictional payer's approved amount.",
    );
  const fictional = (sourceOfferId: string) => {
    const id = installed.offerIds.get(sourceOfferId);
    if (!id)
      throw conflict("A selected offer is absent from the captured shop.");
    return id;
  };
  const expected = step.expected.lines
    .map((line) => `${fictional(line.sourceOfferId)}:${line.quantity}`)
    .sort();
  const actual = quote.lines
    .map((line) => `${line.offerId}:${line.quantity}`)
    .sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw conflict(
      "The quote does not match the fictional person's selected offers and quantities.",
    );
  if (step.kind === "approve_scope") {
    const prices = step.prices.map((price) => ({
      offerId: fictional(price.sourceOfferId),
      unitAmountMinor: price.unitAmountMinor,
    }));
    await approveQuoteScope(installed.owner, {
      quoteId: quote.id,
      expectedRevision: quote.revision,
      approvedScope: step.scope,
      prices,
    });
    approvals.push("seller_scope");
    const approved = await openQuote(buyer);
    if (approved?.totalMinor !== step.expected.totalMinor)
      throw conflict(
        "The seller-approved total differs from the plan, so no payment step ran.",
      );
    return;
  }
  const checkout = await startCheckout(buyer, {
    quoteId: quote.id,
    revision: quote.revision,
  });
  approvals.push("buyer_checkout");
  const backend = getStorage();
  const attempt = await backend.payments.scopedAttempt(
    buyer,
    checkout.attemptId,
  );
  if (!attempt || attempt.environment !== "fixture" || !attempt.providerOrderId)
    throw conflict("The fictional checkout could not be verified.");
  const approved =
    backend.kind === "d1"
      ? await backend.fixture.decideFixtureOrder(
          attempt.providerOrderId,
          "approve",
        )
      : await decideFixtureOrder(getDb(), attempt.providerOrderId, "approve");
  if (approved?.status !== "APPROVED")
    throw conflict("The fictional payer did not approve this payment.");
  approvals.push("fixture_payer");
  if (step.fault === "lost_capture_and_download") {
    if (backend.kind === "d1") {
      await backend.fixture.armFault("capture_lost_after_effect");
      await backend.fixture.armFault("access_storage_error");
    } else {
      await armFault(getDb(), "capture_lost_after_effect");
      await armFault(getDb(), "access_storage_error");
    }
  }
  const paid = await reconcilePayment(buyer, attempt.id, { mayCapture: true });
  if (paid.state !== "paid")
    throw conflict(
      "The fictional payment did not complete. Its records are preserved.",
    );
  const retry = await reconcilePayment(buyer, attempt.id, { mayCapture: true });
  if (retry.state !== "paid" || retry.order?.id !== paid.order?.id)
    throw conflict("Payment recovery changed the fictional order.");
}
