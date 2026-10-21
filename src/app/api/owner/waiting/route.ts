import { requireOwner } from "@/server/auth/owner";
import { queryDesk } from "@/server/domain/desk";
import { openQuestions } from "@/server/domain/seller-questions";
import { ok, route } from "@/server/http/respond";

/** What is waiting on the owner right now, so an open desk can announce a new customer question. */
export const GET = route(async (request, requestId) => {
  const { owner } = await requireOwner(request.headers);
  const [questions, attention] = await Promise.all([
    openQuestions(owner),
    queryDesk(owner, { view: "needs_attention" }),
  ]);
  const newest = questions.reduce<(typeof questions)[number] | null>((latest, q) => (!latest || q.createdAt > latest.createdAt ? q : latest), null);
  return ok(requestId, {
    waiting: questions.length + attention.rows.length,
    questions: questions.length,
    newestQuestion: newest ? { id: newest.id, question: newest.question } : null,
  });
});
