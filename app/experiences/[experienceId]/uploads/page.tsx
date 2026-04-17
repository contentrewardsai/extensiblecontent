import { requireExperienceContext } from "@/lib/experience-context";
import { listAccessibleProjects } from "@/lib/project-access";
import { getProjectStorageStats, getOwnerStorageStats } from "@/lib/project-quota";
import {
	groupPostMediaByProject,
	listPostMediaFilesForOwners,
	type ProjectGroupContext,
} from "@/lib/storage-post-media";
import { listUserWorkflowUploads } from "@/lib/storage-workflow-uploads";
import { getServiceSupabase } from "@/lib/supabase-service";
import { UploadsClient, type UploadProjectOption } from "./uploads-client";

function publicWorkflowDataUrl(objectPath: string): string {
	const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
	return `${base}/storage/v1/object/public/workflow-data/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

export default async function UploadsPage({ params }: { params: Promise<{ experienceId: string }> }) {
	const { experienceId } = await params;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	const accessible = await listAccessibleProjects(supabase, internalUserId);

	// Resolve usage per project (under the owner's prefix). One RPC per project
	// keeps per-project bars accurate even when the user collaborates on
	// multiple owners' projects.
	const projectUsage = await Promise.all(
		accessible.map(async (p) => {
			try {
				const stats = await getProjectStorageStats(supabase, p.owner_id, p.id, p.quota_bytes);
				return { id: p.id, used: stats.usedBytes };
			} catch {
				return { id: p.id, used: 0 };
			}
		}),
	);
	const usedById = new Map(projectUsage.map((u) => [u.id, u.used]));

	// Group accessible projects by owner so we can paginate file listings per
	// owner prefix.
	const ownerGroups = new Map<string, string[]>();
	for (const p of accessible) {
		const arr = ownerGroups.get(p.owner_id);
		if (arr) arr.push(p.id);
		else ownerGroups.set(p.owner_id, [p.id]);
	}

	const [postMediaFiles, userRes, workflowObjects, ownerStats] = await Promise.all([
		listPostMediaFilesForOwners(
			supabase,
			Array.from(ownerGroups, ([ownerId, projectIds]) => ({ ownerId, projectIds })),
		),
		supabase.from("users").select("default_project_id").eq("id", internalUserId).maybeSingle(),
		listUserWorkflowUploads(supabase, internalUserId),
		getOwnerStorageStats(supabase, internalUserId).catch(() => null),
	]);

	const projects: UploadProjectOption[] = accessible
		.filter((p) => p.role === "owner" || p.role === "editor")
		.map((p) => ({ id: p.id, name: p.name, role: p.role }));

	const projectContext: Record<string, ProjectGroupContext> = {};
	for (const p of accessible) {
		projectContext[p.id] = {
			id: p.id,
			name: p.name,
			ownerId: p.owner_id,
			role: p.role,
			quotaBytes: p.quota_bytes,
			usedBytes: usedById.get(p.id) ?? 0,
		};
	}

	const groups = groupPostMediaByProject(postMediaFiles, projectContext);
	const defaultProjectId = (userRes.data?.default_project_id as string | null | undefined) ?? null;

	return (
		<div className="flex flex-col gap-8">
			<div>
				<h2 className="text-6 font-bold text-gray-12">Uploads</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					Files in your Supabase Storage <code className="text-2">post-media</code> buckets, organised by project and
					folder. Add new files from this page or from the extension's <em>Upload to storage</em> step — both write
					to the same location. Shared projects show files attributed to the owner's storage cap.
				</p>
				{ownerStats ? (
					<p className="text-2 text-gray-10 mt-2">
						Your storage:{" "}
						<span className="font-mono text-gray-12">
							{(ownerStats.usedBytes / 1024 / 1024).toFixed(1)} MB
						</span>{" "}
						of <span className="font-mono">{Math.round(ownerStats.maxBytes / 1024 / 1024)} MB</span>
					</p>
				) : null}
			</div>

			<UploadsClient
				experienceId={experienceId}
				projects={projects}
				defaultProjectId={defaultProjectId}
				groups={groups}
			/>

			<section className="flex flex-col gap-3">
				<div>
					<h3 className="text-5 font-semibold text-gray-12">Workflow narration / step media</h3>
					<p className="text-2 text-gray-10 mt-1 max-w-2xl">
						Files written by workflow steps into the <code className="text-2">workflow-data</code> bucket (e.g. TTS
						narration, scratch media). Up to 400 objects listed.
					</p>
				</div>

				{workflowObjects.length === 0 ? (
					<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-6 bg-gray-a2">
						No workflow-step files yet.
					</p>
				) : (
					<div className="overflow-x-auto border border-gray-a4 rounded-lg max-h-[480px] overflow-y-auto">
						<table className="w-full text-left text-3">
							<thead className="bg-gray-a3 border-b border-gray-a4 sticky top-0">
								<tr>
									<th className="p-3 font-semibold text-gray-12">File</th>
									<th className="p-3 font-semibold text-gray-12">Updated</th>
									<th className="p-3 font-semibold text-gray-12">Open</th>
								</tr>
							</thead>
							<tbody>
								{workflowObjects.map((o) => (
									<tr key={o.path} className="border-b border-gray-a4 last:border-0">
										<td className="p-3 text-gray-11 font-mono text-2 break-all">{o.path}</td>
										<td className="p-3 text-gray-10 whitespace-nowrap">
											{o.updated_at ? new Date(o.updated_at).toLocaleString() : "—"}
										</td>
										<td className="p-3">
											<a
												href={publicWorkflowDataUrl(o.path)}
												target="_blank"
												rel="noopener noreferrer"
												className="text-gray-12 underline"
											>
												View
											</a>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
}
