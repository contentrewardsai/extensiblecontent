import type { NextRequest } from "next/server";
import { getInternalUserForExperience } from "@/lib/whop-experience-api-auth";
import { cloneTemplateForWhopUser } from "@/lib/whop-shotstack-template-routes";

function requireExperienceId(request: NextRequest) {
	return request.nextUrl.searchParams.get("experienceId");
}

/**
 * POST /api/whop/shotstack-templates/:id/clone?experienceId=...
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const experienceId = requireExperienceId(request);
	if (!experienceId) {
		return Response.json({ error: "experienceId query parameter is required" }, { status: 400 });
	}
	const auth = await getInternalUserForExperience(request, experienceId);
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
