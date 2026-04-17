"use client";

import { useActionState, useState, useTransition } from "react";
import {
	addProjectMemberAction,
	type AddProjectMemberActionState,
	changeProjectMemberRoleAction,
	createProjectInviteAction,
	type CreateProjectInviteState,
	removeProjectMemberAction,
	revokeProjectInviteAction,
	updateProjectSettingsAction,
	type UpdateProjectActionState,
} from "../../experience-actions";
import type { ProjectAuditEntry } from "@/lib/project-audit";
import type { ProjectInviteRow, ProjectMemberRow } from "@/lib/project-members";
import { formatBytes } from "@/lib/storage-post-media";

interface Props {
	experienceId: string;
	projectId: string;
	myUserId: string;
	role: "owner" | "editor" | "viewer";
	project: {
		id: string;
		name: string;
		description: string | null;
		quotaBytes: number | null;
		ownerId: string;
		createdAt: string;
		updatedAt: string;
	};
	usage: {
		projectUsedBytes: number;
		projectQuotaBytes: number | null;
		ownerUsedBytes: number;
		ownerMaxBytes: number;
	};
	members: ProjectMemberRow[];
	invites: ProjectInviteRow[];
	auditEntries: ProjectAuditEntry[];
	memberNames: Record<string, string>;
}

type Tab = "settings" | "members" | "activity";

const TAB_LABELS: Record<Tab, string> = {
	settings: "Settings",
	members: "Members",
	activity: "Activity",
};

export function ProjectDetailClient(props: Props) {
	const [tab, setTab] = useState<Tab>("settings");

	return (
		<div className="flex flex-col gap-6">
			<UsageSummary usage={props.usage} />
			<nav className="flex gap-2 border-b border-gray-a4">
				{(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={`text-3 px-3 py-2 -mb-px border-b-2 ${
							tab === t ? "border-gray-12 text-gray-12 font-medium" : "border-transparent text-gray-10 hover:text-gray-12"
						}`}
					>
						{TAB_LABELS[t]}
					</button>
				))}
			</nav>
			{tab === "settings" ? (
				<SettingsTab
					experienceId={props.experienceId}
					projectId={props.projectId}
					project={props.project}
					role={props.role}
					ownerCapBytes={props.usage.ownerMaxBytes}
					ownerUsedBytes={props.usage.ownerUsedBytes}
				/>
			) : null}
			{tab === "members" ? (
				<MembersTab
					experienceId={props.experienceId}
					projectId={props.projectId}
					myUserId={props.myUserId}
					role={props.role}
					members={props.members}
					invites={props.invites}
				/>
			) : null}
			{tab === "activity" ? (
				<ActivityTab entries={props.auditEntries} memberNames={props.memberNames} />
			) : null}
		</div>
	);
}

function UsageSummary({ usage }: { usage: Props["usage"] }) {
	const projectPct = usage.projectQuotaBytes && usage.projectQuotaBytes > 0
		? Math.min(100, (usage.projectUsedBytes / usage.projectQuotaBytes) * 100)
		: null;
	const ownerPct = usage.ownerMaxBytes > 0 ? Math.min(100, (usage.ownerUsedBytes / usage.ownerMaxBytes) * 100) : 0;

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
			<UsageBar
				label="This project"
				usedBytes={usage.projectUsedBytes}
				maxBytes={usage.projectQuotaBytes}
				pct={projectPct}
				suffix={usage.projectQuotaBytes == null ? "no sub-cap" : null}
			/>
			<UsageBar
				label="Owner total"
				usedBytes={usage.ownerUsedBytes}
				maxBytes={usage.ownerMaxBytes}
				pct={ownerPct}
			/>
		</div>
	);
}

function UsageBar({
	label,
	usedBytes,
	maxBytes,
	pct,
	suffix,
}: {
	label: string;
	usedBytes: number;
	maxBytes: number | null;
	pct: number | null;
	suffix?: string | null;
}) {
	return (
		<div className="border border-gray-a4 rounded-lg p-3 bg-gray-a2">
			<div className="text-2 text-gray-10">{label}</div>
			<div className="text-3 text-gray-12 font-medium">
				{formatBytes(usedBytes)}
				{maxBytes != null ? <span className="text-gray-10"> / {formatBytes(maxBytes)}</span> : null}
				{suffix ? <span className="text-gray-10"> · {suffix}</span> : null}
			</div>
			<div className="h-1.5 bg-gray-a3 rounded mt-2 overflow-hidden">
				<div className="h-full bg-gray-12" style={{ width: `${pct ?? 0}%` }} />
			</div>
		</div>
	);
}

function SettingsTab({
	experienceId,
	projectId,
	project,
	role,
	ownerCapBytes,
	ownerUsedBytes,
}: {
	experienceId: string;
	projectId: string;
	project: Props["project"];
	role: Props["role"];
	ownerCapBytes: number;
	ownerUsedBytes: number;
}) {
	const initial: UpdateProjectActionState | null = null;
	const [state, formAction, pending] = useActionState(updateProjectSettingsAction, initial);
	const ownerRemainingBytes = Math.max(0, ownerCapBytes - ownerUsedBytes);
	const isOwner = role === "owner";
	const isEditor = role === "editor" || role === "owner";

	return (
		<form action={formAction} className="flex flex-col gap-4 max-w-xl">
			<input type="hidden" name="experienceId" value={experienceId} />
			<input type="hidden" name="projectId" value={projectId} />

			<label className="text-2 text-gray-11 flex flex-col gap-1">
				<span>Name</span>
				<input
					type="text"
					name="name"
					defaultValue={project.name}
					disabled={!isEditor}
					required
					className="text-3 text-gray-12 bg-gray-a2 border border-gray-a4 rounded-md px-2 py-1.5 disabled:opacity-50"
				/>
			</label>

			<label className="text-2 text-gray-11 flex flex-col gap-1">
				<span>Description</span>
				<textarea
					name="description"
					defaultValue={project.description ?? ""}
					rows={3}
					disabled={!isEditor}
					className="text-3 text-gray-12 bg-gray-a2 border border-gray-a4 rounded-md px-2 py-1.5 disabled:opacity-50"
				/>
			</label>

			<label className="text-2 text-gray-11 flex flex-col gap-1">
				<span>
					Storage cap (bytes) <span className="text-gray-10">— owner only</span>
				</span>
				<input
					type="number"
					name="quota_bytes"
					min={0}
					max={ownerCapBytes}
					placeholder="(no sub-cap)"
					defaultValue={project.quotaBytes ?? ""}
					disabled={!isOwner}
					className="text-3 text-gray-12 bg-gray-a2 border border-gray-a4 rounded-md px-2 py-1.5 disabled:opacity-50 font-mono"
				/>
				<span className="text-2 text-gray-10">
					Owner cap is {formatBytes(ownerCapBytes)}; {formatBytes(ownerRemainingBytes)} unused across all of the owner's projects.
				</span>
			</label>

			{isEditor ? (
				<button
					type="submit"
					disabled={pending}
					className="text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 disabled:opacity-50 self-start"
				>
					{pending ? "Saving…" : "Save changes"}
				</button>
			) : (
				<p className="text-2 text-gray-10">You have view-only access.</p>
			)}
			{state && state.ok === false ? <p className="text-2 text-red-11">{state.error}</p> : null}
			{state && state.ok ? <p className="text-2 text-green-11">Saved.</p> : null}
		</form>
	);
}

function MembersTab({
	experienceId,
	projectId,
	myUserId,
	role,
	members,
	invites,
}: {
	experienceId: string;
	projectId: string;
	myUserId: string;
	role: Props["role"];
	members: ProjectMemberRow[];
	invites: ProjectInviteRow[];
}) {
	const isOwner = role === "owner";
	return (
		<div className="flex flex-col gap-6">
			{isOwner ? <AddMemberForm experienceId={experienceId} projectId={projectId} /> : null}

			<section>
				<h3 className="text-4 font-semibold text-gray-12 mb-2">Members ({members.length})</h3>
				<ul className="border border-gray-a4 rounded-lg divide-y divide-gray-a4">
					{members.map((m) => (
						<MemberRow
							key={m.user_id}
							member={m}
							experienceId={experienceId}
							projectId={projectId}
							isOwnerActor={isOwner}
							canLeave={!isOwner && m.user_id === myUserId}
						/>
					))}
				</ul>
			</section>

			{isOwner ? (
				<InvitesSection experienceId={experienceId} projectId={projectId} invites={invites} />
			) : null}
		</div>
	);
}

function AddMemberForm({ experienceId, projectId }: { experienceId: string; projectId: string }) {
	const initial: AddProjectMemberActionState | null = null;
	const [state, formAction, pending] = useActionState(addProjectMemberAction, initial);

	return (
		<form action={formAction} className="border border-gray-a4 rounded-lg p-4 bg-gray-a2 flex flex-col gap-3">
			<div>
				<h3 className="text-4 font-semibold text-gray-12">Add a collaborator</h3>
				<p className="text-2 text-gray-10 mt-1">
					Enter a Whop username (with or without <code className="text-2">@</code>), email, or Whop user id (
					<code className="text-2">user_…</code>). They must have signed in once for username/email lookup.
				</p>
			</div>
			<input type="hidden" name="experienceId" value={experienceId} />
			<input type="hidden" name="projectId" value={projectId} />
			<div className="flex flex-col sm:flex-row gap-2">
				<input
					type="text"
					name="identifier"
					placeholder="@handle, email, or user_…"
					required
					className="text-3 text-gray-12 bg-gray-a1 border border-gray-a4 rounded-md px-2 py-1.5 flex-1"
				/>
				<select
					name="role"
					defaultValue="viewer"
					className="text-3 text-gray-12 bg-gray-a1 border border-gray-a4 rounded-md px-2 py-1.5"
				>
					<option value="viewer">Viewer</option>
					<option value="editor">Editor</option>
				</select>
				<button
					type="submit"
					disabled={pending}
					className="text-3 px-4 py-1.5 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 disabled:opacity-50"
				>
					{pending ? "Adding…" : "Add"}
				</button>
			</div>
			{state && state.ok === false ? <p className="text-2 text-red-11">{state.error}</p> : null}
			{state && state.ok ? <p className="text-2 text-green-11">Added as {state.role}.</p> : null}
		</form>
	);
}

function MemberRow({
	member,
	experienceId,
	projectId,
	isOwnerActor,
	canLeave,
}: {
	member: ProjectMemberRow;
	experienceId: string;
	projectId: string;
	isOwnerActor: boolean;
	canLeave: boolean;
}) {
	const [pending, startTransition] = useTransition();
	const display = member.user.name?.trim() || member.user.email || member.user_id;
	return (
		<li className="flex items-center justify-between p-3 gap-3">
			<div className="min-w-0">
				<div className="text-3 text-gray-12 truncate">{display}</div>
				<div className="text-2 text-gray-10 truncate font-mono">{member.user.email ?? member.user_id}</div>
			</div>
			<div className="flex items-center gap-2 shrink-0">
				{isOwnerActor && member.role !== "owner" ? (
					<form
						action={(formData) => {
							startTransition(async () => {
								await changeProjectMemberRoleAction(formData);
							});
						}}
						className="flex items-center gap-1"
					>
						<input type="hidden" name="experienceId" value={experienceId} />
						<input type="hidden" name="projectId" value={projectId} />
						<input type="hidden" name="userId" value={member.user_id} />
						<select
							name="role"
							defaultValue={member.role}
							onChange={(e) => {
								const form = e.currentTarget.form;
								if (form) form.requestSubmit();
							}}
							className="text-2 text-gray-12 bg-gray-a2 border border-gray-a4 rounded px-2 py-1"
						>
							<option value="viewer">Viewer</option>
							<option value="editor">Editor</option>
							<option value="owner">Owner</option>
						</select>
					</form>
				) : (
					<span className="text-2 text-gray-11 px-2 py-1 rounded bg-gray-a3 capitalize">{member.role}</span>
				)}
				{(isOwnerActor && member.role !== "owner") || canLeave ? (
					<form
						action={(formData) => {
							startTransition(async () => {
								await removeProjectMemberAction(formData);
							});
						}}
					>
						<input type="hidden" name="experienceId" value={experienceId} />
						<input type="hidden" name="projectId" value={projectId} />
						<input type="hidden" name="userId" value={member.user_id} />
						<button
							type="submit"
							disabled={pending}
							className="text-2 px-2 py-1 rounded-md border border-red-a5 text-red-11 hover:bg-red-a3 disabled:opacity-50"
						>
							{canLeave ? "Leave" : "Remove"}
						</button>
					</form>
				) : null}
			</div>
		</li>
	);
}

function InvitesSection({
	experienceId,
	projectId,
	invites,
}: {
	experienceId: string;
	projectId: string;
	invites: ProjectInviteRow[];
}) {
	const initial: CreateProjectInviteState | null = null;
	const [state, formAction, pending] = useActionState(createProjectInviteAction, initial);
	const [revokePending, startRevoke] = useTransition();
	const inviteUrl = (token: string) =>
		typeof window !== "undefined"
			? `${window.location.origin}/experiences/${experienceId}/projects/invite/${token}`
			: `/experiences/${experienceId}/projects/invite/${token}`;

	return (
		<section className="flex flex-col gap-3">
			<form action={formAction} className="border border-gray-a4 rounded-lg p-4 bg-gray-a2 flex flex-col gap-3">
				<div>
					<h3 className="text-4 font-semibold text-gray-12">Create an invite link</h3>
					<p className="text-2 text-gray-10 mt-1">
						Anyone signed in to the dashboard with this link will be added at the chosen role.
					</p>
				</div>
				<input type="hidden" name="experienceId" value={experienceId} />
				<input type="hidden" name="projectId" value={projectId} />
				<div className="flex flex-col sm:flex-row gap-2">
					<select
						name="role"
						defaultValue="viewer"
						className="text-3 text-gray-12 bg-gray-a1 border border-gray-a4 rounded-md px-2 py-1.5"
					>
						<option value="viewer">Viewer</option>
						<option value="editor">Editor</option>
					</select>
					<input
						type="number"
						name="expires_in_hours"
						placeholder="Expires in hours (optional)"
						min={1}
						max={24 * 30}
						className="text-3 text-gray-12 bg-gray-a1 border border-gray-a4 rounded-md px-2 py-1.5 flex-1"
					/>
					<button
						type="submit"
						disabled={pending}
						className="text-3 px-4 py-1.5 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 disabled:opacity-50"
					>
						{pending ? "Creating…" : "Create link"}
					</button>
				</div>
				{state && state.ok === false ? <p className="text-2 text-red-11">{state.error}</p> : null}
				{state && state.ok ? (
					<p className="text-2 text-green-11 break-all">
						Link created: <span className="font-mono">{inviteUrl(state.token)}</span>
					</p>
				) : null}
			</form>

			<h3 className="text-4 font-semibold text-gray-12">Active invites ({invites.length})</h3>
			{invites.length === 0 ? (
				<p className="text-2 text-gray-10">No active invites.</p>
			) : (
				<ul className="border border-gray-a4 rounded-lg divide-y divide-gray-a4">
					{invites.map((inv) => (
						<li key={inv.id} className="p-3 flex items-center justify-between gap-3">
							<div className="min-w-0">
								<div className="text-2 text-gray-11 capitalize">{inv.role}</div>
								<div className="text-2 text-gray-10 font-mono truncate">{inviteUrl(inv.token)}</div>
								<div className="text-2 text-gray-10">
									Expires: {inv.expires_at ? new Date(inv.expires_at).toLocaleString() : "never"}
								</div>
							</div>
							<form
								action={(formData) => {
									startRevoke(async () => {
										await revokeProjectInviteAction(formData);
									});
								}}
							>
								<input type="hidden" name="experienceId" value={experienceId} />
								<input type="hidden" name="projectId" value={projectId} />
								<input type="hidden" name="inviteId" value={inv.id} />
								<button
									type="submit"
									disabled={revokePending}
									className="text-2 px-2 py-1 rounded-md border border-red-a5 text-red-11 hover:bg-red-a3 disabled:opacity-50"
								>
									Revoke
								</button>
							</form>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function ActivityTab({
	entries,
	memberNames,
}: {
	entries: ProjectAuditEntry[];
	memberNames: Record<string, string>;
}) {
	if (entries.length === 0) {
		return <p className="text-2 text-gray-10">No activity recorded yet.</p>;
	}
	return (
		<ul className="border border-gray-a4 rounded-lg divide-y divide-gray-a4">
			{entries.map((entry) => (
				<li key={entry.id} className="p-3 flex flex-col gap-1">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="text-3 text-gray-12 font-medium">{entry.action}</span>
						<span className={`text-2 px-1.5 py-0.5 rounded capitalize ${sourceColor(entry.source)}`}>
							{entry.source}
						</span>
						<span className="text-2 text-gray-10">{new Date(entry.created_at).toLocaleString()}</span>
					</div>
					<div className="text-2 text-gray-10">
						{entry.actor_user_id ? `By ${memberNames[entry.actor_user_id] ?? entry.actor_user_id}` : "By system"}
						{entry.target_type ? ` · target: ${entry.target_type}` : ""}
						{entry.target_id ? ` · ${entry.target_id}` : ""}
					</div>
				</li>
			))}
		</ul>
	);
}

function sourceColor(source: ProjectAuditEntry["source"]): string {
	switch (source) {
		case "user":
			return "bg-blue-a3 text-blue-11";
		case "mcp":
			return "bg-purple-a3 text-purple-11";
		case "backend":
			return "bg-gray-a3 text-gray-11";
		default:
			return "bg-gray-a3 text-gray-11";
	}
}
