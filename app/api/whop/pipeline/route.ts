import type { NextRequest } from "next/server";
import { getInternalUserForExperience } from "@/lib/whop-experience-api-auth";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * GET /api/whop/pipeline?experienceId=…&projectId=…&action=next
 *
 * Fetches the next pending clip from the queue.
 */
export async function GET(request: NextRequest) {
	const sp = request.nextUrl.searchParams;
	const experienceId = sp.get("experienceId") ?? "";
	const projectId = sp.get("projectId") ?? "";
	const action = sp.get("action") ?? "";

	if (!experienceId || !projectId) {
		return Response.json({ error: "experienceId and projectId required" }, { status: 400 });
	}

	const auth = await getInternalUserForExperience(request, experienceId);
	if (!auth.ok) return auth.response;

	const supabase = getServiceSupabase();
	try {
		await assertProjectAccess(supabase, projectId, auth.internalUserId, "editor");
	} catch (err) {
		if (err instanceof ProjectAccessError) {
			return Response.json({ error: err.message }, { status: err.status });
		}
		throw err;
	}

	if (action === "next") {
		const { data, error } = await supabase
			.from("project_clip_queue")
			.select("*, source_video:project_source_videos(id, original_filename, storage_path, ghl_media_url, duration_sec, stt_status, stt_result)")
			.eq("project_id", projectId)
			.in("status", ["pending", "stt", "trimming", "rendering", "posting"])
			.order("created_at", { ascending: true })
			.limit(1)
			.maybeSingle();

		if (error) return Response.json({ error: error.message }, { status: 500 });
		return Response.json({ clip: data });
	}

	if (action === "queue") {
		const { data, error } = await supabase
			.from("project_clip_queue")
			.select("id, status, segment_start_sec, segment_end_sec, output_url, error, created_at, updated_at, source_video_id")
			.eq("project_id", projectId)
			.order("created_at", { ascending: false })
			.limit(50);

		if (error) return Response.json({ error: error.message }, { status: 500 });
		return Response.json({ clips: data });
	}

	if (action === "config") {
		const { data, error } = await supabase
			.from("projects")
			.select("pipeline_clips_per_day, pipeline_default_template_ids, pipeline_posting_target, pipeline_auto_run")
			.eq("id", projectId)
			.single();

		if (error) return Response.json({ error: error.message }, { status: 500 });
		return Response.json({ config: data });
	}

	if (action === "template") {
		const templateId = sp.get("templateId") ?? "";
		if (!templateId) return Response.json({ error: "templateId required" }, { status: 400 });

		const { data, error } = await supabase
			.from("shotstack_templates")
			.select("id, name, edit")
			.eq("id", templateId)
			.maybeSingle();

		if (error) return Response.json({ error: error.message }, { status: 500 });
		if (!data) return Response.json({ error: "Template not found" }, { status: 404 });
		return Response.json({ template: data });
	}

	if (action === "sources-needing-stt") {
		const { data, error } = await supabase
			.from("project_source_videos")
			.select("id, original_filename, storage_path, ghl_media_url, duration_sec, stt_status")
			.eq("project_id", projectId)
			.in("stt_status", ["pending", "failed"])
			.order("created_at", { ascending: true })
			.limit(10);

		if (error) return Response.json({ error: error.message }, { status: 500 });
		return Response.json({ sources: data });
	}

	return Response.json({ error: "Unknown action" }, { status: 400 });
}

/**
 * POST /api/whop/pipeline
 *
 * Updates clip queue status/step_data.
 */
export async function POST(request: NextRequest) {
	let body: {
		experienceId?: string;
		projectId?: string;
		action?: string;
		clipId?: string;
		status?: string;
		stepData?: Record<string, unknown>;
		error?: string;
		outputUrl?: string;
	};
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const experienceId = body.experienceId ?? "";
	const projectId = body.projectId ?? "";
	if (!experienceId || !projectId) {
		return Response.json({ error: "experienceId and projectId required" }, { status: 400 });
	}

	const auth = await getInternalUserForExperience(request, experienceId);
	if (!auth.ok) return auth.response;

	const supabase = getServiceSupabase();
	try {
		await assertProjectAccess(supabase, projectId, auth.internalUserId, "editor");
	} catch (err) {
		if (err instanceof ProjectAccessError) {
			return Response.json({ error: err.message }, { status: err.status });
		}
		throw err;
	}

	if (body.action === "update-clip") {
		const clipId = body.clipId ?? "";
		if (!clipId) return Response.json({ error: "clipId required" }, { status: 400 });

		const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
		if (body.status) update.status = body.status;
		if (body.stepData) update.step_data = body.stepData;
		if (body.error !== undefined) update.error = body.error;
		if (body.outputUrl !== undefined) update.output_url = body.outputUrl;
		if (body.status === "done") update.posted_at = new Date().toISOString();

		const { error } = await supabase
			.from("project_clip_queue")
			.update(update)
			.eq("id", clipId)
			.eq("project_id", projectId);

		if (error) return Response.json({ error: error.message }, { status: 500 });
		return Response.json({ ok: true });
	}

	if (body.action === "update-stt") {
		const sourceVideoId = body.clipId ?? "";
		if (!sourceVideoId) return Response.json({ error: "clipId (sourceVideoId) required" }, { status: 400 });

		const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
		if (body.status) update.stt_status = body.status;
		if (body.stepData) update.stt_result = body.stepData;

		const { error } = await supabase
			.from("project_source_videos")
			.update(update)
			.eq("id", sourceVideoId)
			.eq("project_id", projectId);

		if (error) return Response.json({ error: error.message }, { status: 500 });
		return Response.json({ ok: true });
	}

	if (body.action === "generate-clips") {
		const segments = body.stepData?.segments as Array<{
			start_sec: number;
			end_sec: number;
			text: string;
			score: number;
		}> | undefined;
		const sourceVideoId = body.clipId ?? "";
		const templateId = (body.stepData?.template_id as string) || null;

		if (!sourceVideoId || !segments?.length) {
			return Response.json({ error: "sourceVideoId and segments required" }, { status: 400 });
		}

		const rows = segments.map((seg) => ({
			project_id: projectId,
			source_video_id: sourceVideoId,
			segment_start_sec: seg.start_sec,
			segment_end_sec: seg.end_sec,
			template_id: templateId,
			status: "pending",
			step_data: { text: seg.text, score: seg.score },
		}));

		const { error } = await supabase.from("project_clip_queue").insert(rows);
		if (error) return Response.json({ error: error.message }, { status: 500 });
		return Response.json({ ok: true, count: rows.length });
	}

	return Response.json({ error: "Unknown action" }, { status: 400 });
}
