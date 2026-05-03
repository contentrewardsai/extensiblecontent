import Link from "next/link";
import { notFound } from "next/navigation";
import { requireExperienceContext } from "@/lib/experience-context";
import { getServiceSupabase } from "@/lib/supabase-service";
import { ShotstackEditorHost } from "../../shotstack-editor-host";
import type { ShotstackEditorContext } from "../../shotstack-editor-context";

/**
 * Open an editable template. Built-ins open read-only; saving from a built-in triggers
 * an implicit clone on the server (handled by ShotstackEditorHost). We scope template
 * visibility to templates the user owns or project-shared rows, plus built-ins.
 */
export default async function ShotstackEditorPage({
	params,
}: {
	params: Promise<{ experienceId: string; templateId: string }>;
}) {
	const { experienceId, templateId } = await params;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();
	const { data: memberRows } = await supabase
		.from("project_members")
		.select("project_id")
		.eq("user_id", internalUserId);
	const memberProjectIds = Array.from(
		new Set(
			((memberRows ?? []) as Array<{ project_id: string | null }>)
				.map((r) => r.project_id)
				.filter((id): id is string => typeof id === "string" && id.length > 0),
		),
	);
	const orParts: string[] = [`user_id.eq.${internalUserId}`, "is_builtin.eq.true"];
	if (memberProjectIds.length > 0) {
		orParts.push(`project_id.in.(${memberProjectIds.join(",")})`);
	}
	const { data: row, error } = await supabase
		.from("shotstack_templates")
		.select("id, name, edit, default_env, is_builtin, user_id")
		.eq("id", templateId)
		.or(orParts.join(","))
		.maybeSingle();
	if (error || !row?.edit || typeof row.edit !== "object") {
		notFound();
	}
	return (
		<div className="flex flex-col gap-4 max-w-7xl">
			<div className="flex flex-wrap items-center gap-3 text-3 text-gray-11">
				<Link href={`/experiences/${experienceId}/shotstack`} className="text-gray-12 underline">
					← Back
				</Link>
				<span className="text-gray-10">|</span>
				<span className="text-gray-12 font-medium">{row.name}</span>
				{row.is_builtin ? (
					<span className="inline-flex items-center rounded-full border border-gray-a6 px-2 py-0.5 text-2 text-gray-11">
						Starter · read-only (save will clone)
					</span>
				) : null}
			</div>
			<ShotstackEditorHost
				templateId={row.id}
				templateName={row.name}
				isBuiltin={!!row.is_builtin}
				initialEdit={row.edit as Record<string, unknown>}
				context={buildWhopEditorContext(experienceId)}
			/>
		</div>
	);
}

function buildWhopEditorContext(experienceId: string): ShotstackEditorContext {
	const query = `experienceId=${encodeURIComponent(experienceId)}`;
	return {
		templatesApiBase: "/api/whop/shotstack-templates",
		templatesApiQuery: query,
		browserRenderUrl: "/api/whop/shotstack/browser-render",
		browserRenderFields: { experienceId },
		editorUrlPrefix: `/experiences/${experienceId}/shotstack/editor`,
		backUrl: `/experiences/${experienceId}/shotstack`,
		thumbnailUploadUrl: `/api/whop/shotstack-templates/:id/thumbnail?${query}`,
		imageUploadUrl: `/api/whop/shotstack-templates/upload-image?${query}`,
		videoUploadUrl: `/api/whop/shotstack-templates/upload-video?${query}`,
		presignedUploadUrl: "/api/whop/shotstack/presigned-upload",
		confirmUploadUrl: "/api/whop/shotstack/confirm-upload",
	};
}
