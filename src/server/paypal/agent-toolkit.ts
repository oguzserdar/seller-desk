/**
 * PayPal's own Agent Toolkit, offered to the owner's desk assistant as read-only tools.
 *
 * Two rails, kept apart on purpose. PayPal's toolkit lets a model read the PayPal account: an
 * order as PayPal holds it, recent transactions, invoices and disputes. Checkout stays in this
 * server's own code (create, retrieve, capture, webhook), where the merchant, amount and currency
 * are checked before an order exists. The toolkit is configured with its read actions only, and
 * the names it returns are checked against a fixed list again here, so a later toolkit version
 * cannot hand the model a tool that creates, pays, refunds or cancels anything.
 */
import { tool, type Tool } from "ai";
import { getEffectiveConfig } from "@/server/effective-config";

/** The only toolkit tools the desk assistant may be given. Every one of them reads. */
export const PAYPAL_READ_TOOLS = ["get_order", "list_transactions", "list_invoices", "get_invoice", "list_disputes", "get_dispute"] as const;

const READ_ACTIONS = {
  orders: { get: true },
  transactions: { list: true },
  invoices: { list: true, get: true },
  disputes: { list: true, get: true },
};

type ToolkitTool = { description?: string; parameters: unknown; execute?: (input: never, options: never) => Promise<unknown> };

/**
 * Keeps the read tools from whatever the toolkit returned and rebuilds each in this app's tool
 * shape. The toolkit targets an older AI SDK whose tools name their input schema `parameters`.
 *
 * @param provided - The toolkit's tools, by name
 * @returns Read-only tools prefixed `paypal_`, ready for the desk assistant
 */
export function readOnlyPayPalTools(provided: Record<string, ToolkitTool>): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const name of PAYPAL_READ_TOOLS) {
    const source = provided[name];
    if (!source?.execute) continue;
    const run = source.execute;
    tools[`paypal_${name}`] = tool({
      description: `${(source.description ?? name).trim()}\nRead-only, straight from PayPal. Use it to check what PayPal itself holds; never to decide that something is paid.`,
      inputSchema: source.parameters as never,
      execute: async (input: unknown) => {
        try {
          return await run(input as never, {} as never);
        } catch (error) {
          console.error(JSON.stringify({ event: "paypal-toolkit-read-failed", tool: name, error: error instanceof Error ? error.name : "unknown" }));
          return { error: "PayPal did not answer that. Try again in a minute." };
        }
      },
    }) as Tool;
  }
  return tools;
}

/** Whether this installation offers the toolkit's read tools: switched on, with a real PayPal app. */
export async function payPalToolkitState(): Promise<"on" | "off" | "needs-paypal"> {
  const config = await getEffectiveConfig();
  if (!config.paypalAgentToolkit) return "off";
  return config.paypal.status === "ready" ? "on" : "needs-paypal";
}

/**
 * PayPal's read tools for the owner's desk assistant, or none when the option is off.
 *
 * @returns Tools keyed `paypal_<name>`; an empty object when off or when PayPal is not connected
 */
export async function payPalReadTools(): Promise<Record<string, Tool>> {
  const config = await getEffectiveConfig();
  if (!config.paypalAgentToolkit || config.paypal.status !== "ready") return {};
  try {
    const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
    const toolkit = new PayPalAgentToolkit({
      clientId: config.paypal.clientId,
      clientSecret: config.paypal.clientSecret,
      // This build takes sandbox payments only, so the toolkit reads the sandbox account too.
      configuration: { actions: READ_ACTIONS, context: { sandbox: true, merchant_id: config.paypal.merchantId } },
    });
    return readOnlyPayPalTools(toolkit.getTools() as unknown as Record<string, ToolkitTool>);
  } catch (error) {
    console.error(JSON.stringify({ event: "paypal-toolkit-unavailable", error: error instanceof Error ? error.name : "unknown" }));
    return {};
  }
}
