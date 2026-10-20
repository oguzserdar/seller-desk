import { LinkButton } from "@/components/link-button";

/** A readable recovery path when a historical shop link was edited or withdrawn. */
export default function UnavailableShopStep() {
  return <main className="mx-auto max-w-xl px-6 py-20">
    <p className="text-ink-3 mb-3 text-[14px]">Shop link updated</p>
    <h1 className="page-title">This step has changed.</h1>
    <p className="text-ink-2 mt-4 text-[17px] leading-relaxed">The shop changed or removed the link in that earlier reply. Return to your conversation and ask for the current next step.</p>
    <LinkButton href="/buy" className="mt-7">Back to your conversation</LinkButton>
  </main>;
}
