import type { NextRequest } from "next/server";
import { getInternalUserForGhlFromQuery } from "@/lib/ghl-shotstack-auth";
import {
	createTemplateForWhopUser,
	listTemplatesForWhopUser,
} from "@/lib/whop-shotstack-template-routes";

/**
 * GET  /api/ghl/shotstack-templates?locationId=...&companyId=...
 * POST /api/ghl/shotstack-templates?locationId=...&companyId=...
 *
 * Mirrors /api/whop/shotstack-templates but authenticates via the GHL
 * `ec_whop_user` cookie. Returns user + project-shared + built-in templates.
 */
export async function GET(request: NextRequest) {
	const auth = await getInternalUserForGhlFromQuery(request);
	if (!auth.ok) return auth.response;
	const res = await listTemplatesForWhopUser(auth.internalUserId);
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return Response.json(res.data);
}

export async function POST(request: NextRequest) {
	const auth = await getInternalUserForGhlFromQuery(request);
	if (!auth.ok) return auth.response;
	let body: { name: string; edit?: Record<string, unknown>; default_env?: string; project_id?: string | null };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}
	const res = await createTemplateForWhopUser(auth.internalUserId, body);
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return Response.json(res.data);
}
