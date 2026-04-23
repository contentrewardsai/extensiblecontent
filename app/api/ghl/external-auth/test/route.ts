import type { NextRequest } from "next/server";
import { getUserIdFromBearer } from "@/lib/ghl-external-auth";

/**
 * GET /api/ghl/external-auth/test
 *
 * GHL calls this to verify authentication credentials work.
 * Returns 200 if the Bearer JWT is valid.
 */
export async function GET(request: NextRequest) {
	const userId = await getUserIdFromBearer(
		request.headers.get("authorization"),
	);
	if (!userId) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	return Response.json({ ok: true, user_id: userId });
}
