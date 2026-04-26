import type { NextRequest } from "next/server";
import { getInternalUserForGhlFromQuery } from "@/lib/ghl-shotstack-auth";
import { cloneTemplateForWhopUser } from "@/lib/whop-shotstack-template-routes";

/**
 * POST /api/ghl/shotstack-templates/:id/clone?locationId=...&companyId=...
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const auth = await getInternalUserForGhlFromQuery(request);
	if (!auth.ok) return auth.response;
	const { id } = await params;
	let body: { name?: string; project_id?: string | null } = {};
	try {
		const text = await request.text();
		if (text) body = JSON.parse(text);
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}
	const res = await cloneTemplateForWhopUser(auth.internalUserId, id, body);
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return Response.json(res.data);
}
