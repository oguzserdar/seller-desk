"use client";

import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { Button } from "@/components/arc/button/button";
import { setPublishedAction } from "./actions";

export function PublishToggle({ offerId, revision, published, blocked, title }: { offerId: string; revision: number; published: boolean; blocked: boolean; title: string }) {
  const router = useRouter();
  const toggle = useAction(setPublishedAction, { onSuccess: () => router.refresh() });
  const error = toggle.result.serverError;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={published ? "ghost" : "primary"}
        disabled={!published && blocked}
        loading={toggle.isPending}
        aria-label={`${published ? "Unpublish" : "Publish"} ${title}`}
        onClick={() => toggle.execute({ offerId, expectedRevision: revision, published: !published })}
      >
        {published ? "Unpublish" : "Publish"}
      </Button>
      {error ? (
        <span role="alert" className="text-danger max-w-56 text-right text-[13px]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
