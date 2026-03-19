import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { getShotStackStatus } from "@/lib/shotstack";

/**
 * GET: Check ShotStack render status.
 * Query: ?env=stage|v1
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const env = (request.nextUrl.searchParams.get("env") as "stage" | "v1") ?? "v1";

	const status = await getShotStackStatus(id, { env });
	if (!status) {
		return Response.json({ error: "Render not found or ShotStack not configured" }, { status: 404 });
	}

	return Response.json({
		id: status.id,
		status: status.status,
		url: status.url,
		error: status.error,
	});
}
