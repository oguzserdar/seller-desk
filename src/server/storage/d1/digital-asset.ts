import { sha256Hex } from "@/server/crypto";
import { auditEvent, digitalAsset } from "@/server/db/sqlite/schema";
import {
  MAX_ASSET_BYTES,
  safeFilename,
  sniffMime,
} from "@/server/domain/digital";
import { invalid } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import type { D1Db } from "./client";
import { batchGuard, clearBatchGuards, ownerScope } from "./guards";

/** Private native BLOB upload with unchanged file limits, sniffing and owner scope. */
export function createD1AssetStorage(db: D1Db) {
  return {
    async storeAsset(
      owner: OwnerPrincipal,
      file: { filename: string; bytes: Buffer },
    ) {
      if (!file.bytes.length) throw invalid("The file is empty.");
      if (file.bytes.length > MAX_ASSET_BYTES)
        throw invalid("Files can be at most 1 MiB in this release.");
      const mimeType = sniffMime(file.bytes);
      if (!mimeType) throw invalid("Upload a ZIP, PDF, PNG or JPEG file.");
      const id = crypto.randomUUID(),
        execution = crypto.randomUUID(),
        filename = safeFilename(file.filename);
      await db.batch([
        batchGuard(db, `${execution}:upload`, ownerScope(owner)),
        db
          .insert(digitalAsset)
          .values({
            id,
            sellerId: owner.sellerId,
            filename,
            mimeType,
            sizeBytes: file.bytes.length,
            sha256: sha256Hex(file.bytes),
            bytes: file.bytes,
          }),
        db
          .insert(auditEvent)
          .values({
            actor: "owner",
            actorId: owner.userId,
            operation: "asset.upload",
            targetType: "digital_asset",
            targetId: id,
            outcome: "ok",
            details: { sizeBytes: file.bytes.length, mimeType },
          }),
        clearBatchGuards(db, execution),
      ]);
      return { id, filename, sizeBytes: file.bytes.length, mimeType };
    },
  };
}
