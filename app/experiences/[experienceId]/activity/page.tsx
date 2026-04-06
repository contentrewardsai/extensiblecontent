import { connectedFromLastSeen } from "@/lib/extension-sidebar";
import { requireExperienceContext } from "@/lib/experience-context";
import { getServiceSupabase } from "@/lib/supabase-service";

export default async function ActivityPage({ params }: { params: Promise<{ experienceId: string }> }) {
	const { experienceId } = await params;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	const { data: sidebars, error } = await supabase
		.from("sidebars")
		.select("id, sidebar_name, window_id, last_seen, active_project_id, created_at")
		.eq("user_id", internalUserId)
		.order("last_seen", { ascending: false });

	if (error) {
		return <p className="text-3 text-red-11">Could not load sidebars.</p>;
	}

	const projectIds = [...new Set((sidebars ?? []).map((s) => s.active_project_id).filter(Boolean))] as string[];
	let projectNames: Record<string, string> = {};
	if (projectIds.length > 0) {
		const { data: projects } = await supabase.from("projects").select("id, name").in("id", projectIds);
		projectNames = Object.fromEntries((projects ?? []).map((p) => [p.id as string, p.name as string]));
	}

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h2 className="text-6 font-bold text-gray-12">Sidebar activity</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					Connected extension side panels and last heartbeat. This is not a full workflow run log — only registration
					and presence synced from the extension.
				</p>
			</div>

			{(sidebars ?? []).length === 0 ? (
				<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-6 bg-gray-a2">
					No sidebars yet. Open the Chrome extension side panel while signed in; it will register here.
				</p>
			) : (
				<div className="overflow-x-auto border border-gray-a4 rounded-lg">
					<table className="w-full text-left text-3">
						<thead className="bg-gray-a3 border-b border-gray-a4">
							<tr>
								<th className="p-3 font-semibold text-gray-12">Name</th>
								<th className="p-3 font-semibold text-gray-12">Status</th>
								<th className="p-3 font-semibold text-gray-12">Last seen</th>
								<th className="p-3 font-semibold text-gray-12">Active project</th>
								<th className="p-3 font-semibold text-gray-12">Window</th>
							</tr>
						</thead>
						<tbody>
							{(sidebars ?? []).map((s) => (
								<tr key={s.id} className="border-b border-gray-a4 last:border-0">
									<td className="p-3 text-gray-12">{s.sidebar_name}</td>
									<td className="p-3 text-gray-11">
										{connectedFromLastSeen(s.last_seen) ? "Connected" : "Offline"}
									</td>
									<td className="p-3 text-gray-11">{s.last_seen ? new Date(s.last_seen).toLocaleString() : "—"}</td>
									<td className="p-3 text-gray-11">
										{s.active_project_id ? (projectNames[s.active_project_id] ?? s.active_project_id) : "—"}
									</td>
									<td className="p-3 text-gray-10 font-mono text-2 truncate max-w-[120px]" title={s.window_id}>
										{s.window_id}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
