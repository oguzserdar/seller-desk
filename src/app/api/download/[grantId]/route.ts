import { downloadWithGrant } from "@/server/domain/digital";
import { clientKey, requireUsage } from "@/server/domain/usage";
import { failure } from "@/server/http/respond";

/**
 * Protected download. The grant token arrives in a POSTed form field (never in
 * the URL), and the file is served as an attachment that is never cached.
 */
export async function POST(request: Request, { params }: { params: Promise<{ grantId: string }> }): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    await requireUsage("download_client", clientKey(request.headers), 600, 60, "Too many downloads from this connection.");
    const { grantId } = await params;
    const form = await request.formData();
    const token = form.get("token");
    const file = await downloadWithGrant(grantId, typeof token === "string" ? token : "");
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return failure(requestId, error);
  }
}
