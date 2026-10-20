import * as conversation from "@/server/ai/conversation";
import * as ownerConversation from "@/server/ai/owner-conversation";
import * as turns from "@/server/ai/turn-control";
import { createD1Auth, getAuth } from "@/server/auth/auth";
import * as sessions from "@/server/domain/buyer-session";
import * as control from "@/server/domain/conversation-control";
import * as delivery from "@/server/domain/conversation-messages";
import * as usage from "@/server/domain/usage";
import { createD1BuyerSessionStorage } from "@/server/storage/d1/buyer-session";
import { createD1Db } from "@/server/storage/d1/client";
import { createD1ConversationStorage } from "@/server/storage/d1/conversation";
import { createD1ConversationControl } from "@/server/storage/d1/conversation-control";
import { createD1ConversationMessages } from "@/server/storage/d1/conversation-messages";
import { createD1ConversationReads } from "@/server/storage/d1/conversation-read";
import { createD1OwnerConversationStorage } from "@/server/storage/d1/owner-conversation";
import { createD1UsageStorage } from "@/server/storage/d1/usage";
import type { StorageFixture } from "./storage-fixture";

/** The same acceptance calls target actual native operations on either installation. */
export function conversationStorage(f: StorageFixture) {
  if (f.binding) {
    const db = createD1Db(f.binding);
    return {
      ...createD1ConversationStorage(db),
      ...createD1ConversationReads(db),
      ...createD1ConversationControl(db),
      ...createD1ConversationMessages(db),
      ...createD1OwnerConversationStorage(db),
      ...createD1BuyerSessionStorage(db),
      ...createD1UsageStorage(db),
      auth: createD1Auth(db),
    };
  }
  return {
    ensureConversation: conversation.ensureConversation,
    loadMessages: (id: string) => conversation.loadMessages(id),
    saveMessages: (
      id: string,
      messages: Parameters<typeof conversation.saveMessages>[1],
    ) => conversation.saveMessages(id, messages),
    claimTurn: turns.claimTurn,
    releaseTurn: turns.releaseTurn,
    completeTurn: (
      claim: turns.TurnClaim,
      messages: Parameters<typeof turns.completeTurn>[1],
    ) => turns.completeTurn(claim, messages),
    readBuyerConversation: delivery.readBuyerConversation,
    readSellerConversation: delivery.readSellerConversation,
    readOwnerConversationControl: control.readOwnerConversationControl,
    readBuyerConversationControl: control.readBuyerConversationControl,
    listSellerConversations: delivery.listSellerConversations,
    changeConversationHandler: control.changeConversationHandler,
    receiveBuyerMessage: delivery.receiveBuyerMessage,
    sendSellerMessage: delivery.sendSellerMessage,
    ...ownerConversation,
    ...sessions,
    ...usage,
    auth: getAuth(),
  };
}
