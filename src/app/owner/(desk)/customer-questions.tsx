/** One question a customer is waiting on, as the desk shows it. */
export type CustomerQuestion = {
  id: string;
  conversationId: string;
  revision: number;
  question: string;
  customerGoal: string;
  knownFacts: string[];
  askedAt: string;
  quoteReviewId?: string;
};
