import Link from "next/link";
import { notFound } from "next/navigation";
import { requireExperienceContext } from "@/lib/experience-context";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { listProjectAuditEntries } from "@/lib/project-audit";
import { listActiveInvites, listProjectMembers } from "@/lib/project-members";
import {
	getOwnerStorageStats,
	getProjectStorageStats,
	OWNER_DEFAULT_MAX_BYTES,
} from "@/lib/project-quota";
import { getServiceSupabase } from "@/lib/supabase-service";
import { ProjectDetailClient } from "./project-detail-client";

export default async function ProjectDetailPage({
	params,
}: {
	params: Promise<{ experienceId: string; projectId: string }>;
}) {
	const { experienceId, projectId } = await params;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	let membership: Awaited<ReturnType<typeof assertProjectAccess>>;
	try {
		membership = await assertProjectAccess(supabase, projectId, internalUserId, "viewer");
	} catch (e) {
		if (e instanceof ProjectAccessError && e.status === 404) notFound();
		throw e;
	}

	const { data: project } = await supabase
		.from("projects")
		.select("id, name, description, quota_bytes, owner_id, created_at, updated_at")
		.eq("id", projectId)
		.single();
	if (!project) notFound();

	const [members, invites, auditEntries, projectStats, ownerStats] = await Promise.all([
		listProjectMembers(supabase, projectId),
		membership.role === "owner" ? listActiveInvites(supabase, projectId) : Promise.resolve([]),
		listProjectAuditEntries(supabase, projectId, { limit: 100 }),
		getProjectStorageStats(supabase, project.owner_id, projectId, project.quota_bytes ?? null),
		getOwnerStorageStats(supabase, project.owner_id),
	]);

	const memberNames: Record<string, string> = {};
	for (const m of members) {
		memberNames[m.user_id] = m.user.name?.trim() || m.user.email || m.user_id;
	}

	return (
		<div className="flex flex-col gap-6">
			<div>
				<Link
					href={`/experiences/${experienceId}/uploads`}
					className="text-2 text-gray-10 hover:text-gray-12 underline"
				>
					← All projects
				</Link>
				<h2 className="text-6 font-bold text-gray-12 mt-2">{project.name as string}</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					{(project.description as string | null) || "No description yet."}
				</p>
				<div className="flex flex-wrap items-center gap-3 mt-2 text-2 text-gray-10">
					<span className="font-mono text-2">{projectId}</span>
					<span>·</span>
					<span>
						Your role:{" "}
						<span className="px-1.5 py-0.5 rounded bg-gray-a3 text-gray-12 capitalize">{membership.role}</span>
					</span>
				</div>
			</div>

			<ProjectDetailClient
				experienceId={experienceId}
				projectId={projectId}
				myUserId={internalUserId}
				role={membership.role}
				project={{
					id: projectId,
					name: project.name as string,
					description: (project.description as string | null) ?? null,
					quotaBytes: (project.quota_bytes as number | null) ?? null,
					ownerId: project.owner_id as string,
					createdAt: project.created_at as string,
					updatedAt: project.updated_at as string,
				}}
				usage={{
					projectUsedBytes: projectStats.usedBytes,
					projectQuotaBytes: project.quota_bytes as number | null,
					ownerUsedBytes: ownerStats.usedBytes,
					ownerMaxBytes: OWNER_DEFAULT_MAX_BYTES,
				}}
				members={members}
				invites={invites}
				auditEntries={auditEntries}
				memberNames={memberNames}
			/>
		</div>
	);
}
