import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

/**
 * GET: Return Upload-Post API key for extension to post directly (Method A).
 * Requires valid Bearer token. Key should be rotated periodically (e.g. every few days).
 *
 * Security: Anyone with the extension can use this key. Rotate UPLOAD_POST_EXTENSION_KEY
 * frequently. For higher security, use cloud posting (Method B) instead.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	// Use dedicated extension key if set; otherwise fall back to main key
	const key = process.env.UPLOAD_POST_EXTENSION_KEY ?? process.env.UPLOAD_POST_API_KEY ?? null;
	if (!key) {
		return Response.json({ error: "Upload-Post not configured" }, { status: 503 });
	}

	return Response.json({
		api_key: key,
		// Hint for extension: key may be rotated
		expires_hint: "Rotate every few days",
	});
}
