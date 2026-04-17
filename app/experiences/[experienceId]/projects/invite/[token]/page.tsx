import Link from "next/link";
import { requireExperienceContext } from "@/lib/experience-context";
import { getServiceSupabase } from "@/lib/supabase-service";
import { InviteAcceptClient } from "./invite-accept-client";

export default async function ProjectInviteAcceptPage({
	params,
}: {
	params: Promise<{ experienceId: string; token: string }>;
}) {
	const { experienceId, token } = await params;
	await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	const { data: invite } = await supabase
		.from("project_invites")
		.select("id, project_id, role, expires_at, used_at, revoked_at, projects:projects!project_invites_project_id_fkey(name, description)")
		.eq("token", token)
		.maybeSingle();

	if (!invite) {
		return <InviteState experienceId={experienceId} title="Invite not found" detail="The link is invalid or has been removed." />;
	}
	if (invite.revoked_at) {
		return <InviteState experienceId={experienceId} title="Invite revoked" detail="This invite has been revoked by the project owner." />;
	}
	if (invite.used_at) {
		return <InviteState experienceId={experienceId} title="Invite already used" detail="This invite has already been redeemed." />;
	}
	if (invite.expires_at && new Date(invite.expires_at as string).getTime() < Date.now()) {
		return <InviteState experienceId={experienceId} title="Invite expired" detail="This invite is past its expiration date." />;
	}

	const projectInfo = Array.isArray(invite.projects) ? invite.projects[0] : invite.projects;
	const projectName = (projectInfo?.name as string | undefined) ?? "a project";
	const projectDescription = (projectInfo?.description as string | null | undefined) ?? null;

	return (
		<div className="max-w-xl mx-auto py-10">
			<div className="border border-gray-a4 rounded-xl p-6 bg-gray-a2 flex flex-col gap-4">
				<div>
					<h1 className="text-6 font-bold text-gray-12">You've been invited</h1>
					<p className="text-3 text-gray-10 mt-1">
						You've been invited to join <strong>{projectName}</strong> as{" "}
						<span className="px-1.5 py-0.5 rounded bg-gray-a3 text-gray-12 capitalize">{invite.role as string}</span>.
					</p>
					{projectDescription ? (
						<p className="text-2 text-gray-10 mt-2">{projectDescription}</p>
					) : null}
					{invite.expires_at ? (
						<p className="text-2 text-gray-10 mt-2">
							Expires {new Date(invite.expires_at as string).toLocaleString()}
						</p>
					) : null}
				</div>
				<InviteAcceptClient experienceId={experienceId} token={token} />
			</div>
		</div>
	);
}

function InviteState({
	experienceId,
	title,
	detail,
}: {
	experienceId: string;
	title: string;
	detail: string;
}) {
	return (
		<div className="max-w-xl mx-auto py-10">
			<div className="border border-gray-a4 rounded-xl p-6 bg-gray-a2 flex flex-col gap-3">
				<h1 className="text-6 font-bold text-gray-12">{title}</h1>
				<p className="text-3 text-gray-10">{detail}</p>
				<Link
					href={`/experiences/${experienceId}/uploads`}
					className="text-3 text-gray-12 underline self-start"
				>
					Back to your projects
				</Link>
			</div>
		</div>
	);
}
