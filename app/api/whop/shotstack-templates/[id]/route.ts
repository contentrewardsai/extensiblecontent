import type { NextRequest } from "next/server";
import { getInternalUserForExperience } from "@/lib/whop-experience-api-auth";
import {
	deleteTemplateForWhopUser,
	getTemplateByIdForWhopUser,
	patchTemplateForWhopUser,
} from "@/lib/whop-shotstack-template-routes";

function requireExperienceId(request: NextRequest) {
	return request.nextUrl.searchParams.get("experienceId");
}

/**
 * GET /api/whop/shotstack-templates/:id?experienceId=...
 * PATCH /api/whop/shotstack-templates/:id?experienceId=...
 * DELETE /api/whop/shotstack-templates/:id?experienceId=...
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const experienceId = requireExperienceId(request);
	if (!experienceId) {
		return Response.json({ error: "experienceId query parameter is required" }, { status: 400 });
	}
	const auth = await getInternalUserForExperience(request, experienceId);
	if (!auth.ok) return auth.response;
	const { id } = await params;
	const res = await getTemplateByIdForWhopUser(auth.internalUserId, id);
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return Response.json(res.data);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const experienceId = requireExperienceId(request);
	if (!experienceId) {
		return Response.json({ error: "experienceId query parameter is required" }, { status: 400 });
	}
	const auth = await getInternalUserForExperience(request, experienceId);
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
	const experienceId = requireExperienceId(request);
	if (!experienceId) {
		return Response.json({ error: "experienceId query parameter is required" }, { status: 400 });
	}
	const auth = await getInternalUserForExperience(request, experienceId);
	if (!auth.ok) return auth.response;
	const { id } = await params;
	const res = await deleteTemplateForWhopUser(auth.internalUserId, id);
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return new Response(null, { status: 204 });
}
