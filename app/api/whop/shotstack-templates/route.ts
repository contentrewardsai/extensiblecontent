import type { NextRequest } from "next/server";
import { getInternalUserForExperience } from "@/lib/whop-experience-api-auth";
import {
	createTemplateForWhopUser,
	listTemplatesForWhopUser,
} from "@/lib/whop-shotstack-template-routes";

function requireExperienceId(request: NextRequest) {
	return request.nextUrl.searchParams.get("experienceId");
}

/**
 * GET /api/whop/shotstack-templates?experienceId=...
 * POST /api/whop/shotstack-templates?experienceId=...
 */
export async function GET(request: NextRequest) {
	const experienceId = requireExperienceId(request);
	if (!experienceId) {
		return Response.json({ error: "experienceId query parameter is required" }, { status: 400 });
	}
	const auth = await getInternalUserForExperience(request, experienceId);
	if (!auth.ok) return auth.response;
	const res = await listTemplatesForWhopUser(auth.internalUserId);
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return Response.json(res.data);
}

export async function POST(request: NextRequest) {
	const experienceId = requireExperienceId(request);
	if (!experienceId) {
		return Response.json({ error: "experienceId query parameter is required" }, { status: 400 });
	}
	const auth = await getInternalUserForExperience(request, experienceId);
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
