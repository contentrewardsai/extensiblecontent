import type { NextRequest } from "next/server";
import { getInternalUserForGhlFromQuery } from "@/lib/ghl-shotstack-auth";
import {
	deleteTemplateForWhopUser,
	getTemplateByIdForWhopUser,
	patchTemplateForWhopUser,
} from "@/lib/whop-shotstack-template-routes";

/**
 * GET    /api/ghl/shotstack-templates/:id?locationId=...&companyId=...
 * PATCH  /api/ghl/shotstack-templates/:id?locationId=...&companyId=...
 * DELETE /api/ghl/shotstack-templates/:id?locationId=...&companyId=...
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const auth = await getInternalUserForGhlFromQuery(request);
	if (!auth.ok) return auth.response;
	const { id } = await params;
	const res = await getTemplateByIdForWhopUser(auth.internalUserId, id);
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return Response.json(res.data);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const auth = await getInternalUserForGhlFromQuery(request);
	if (!auth.ok) return auth.response;
	const { id } = await params;
	let body: { name?: string; edit?: Record<string, unknown>; default_env?: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}
	const res = await patchTemplateForWhopUser(auth.internalUserId, id, body);
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return Response.json(res.data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const auth = await getInternalUserForGhlFromQuery(request);
	if (!auth.ok) return auth.response;
	const { id } = await params;
	const res = await deleteTemplateForWhopUser(auth.internalUserId, id);
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return new Response(null, { status: 204 });
}
