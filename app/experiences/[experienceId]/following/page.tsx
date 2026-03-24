import { requireExperienceContext } from "@/lib/experience-context";
import { listFollowingWithJoins } from "@/lib/queries/following";
import { getServiceSupabase } from "@/lib/supabase-service";

export default async function FollowingPage({ params }: { params: Promise<{ experienceId: string }> }) {
	const { experienceId } = await params;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	let list;
	try {
		list = await listFollowingWithJoins(supabase, internalUserId);
	} catch {
		return <p className="text-3 text-red-11">Could not load following.</p>;
	}

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h2 className="text-6 font-bold text-gray-12">Following</h2>
				<p className="text-3 text-gray-10 mt-1">People and contacts you track from the extension.</p>
			</div>

			{list.length === 0 ? (
				<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-6 bg-gray-a2">
					No entries yet. Add contacts from the extension Following section.
				</p>
			) : (
				<ul className="flex flex-col gap-3">
					{list.map((f) => (
						<li
							key={f.id as string}
							className="border border-gray-a4 rounded-lg p-4 bg-gray-a2 flex flex-col gap-2"
						>
							<div className="flex flex-wrap items-baseline justify-between gap-2">
								<span className="text-5 font-semibold text-gray-12">{f.name as string}</span>
								<span className="text-2 text-gray-10">
									Updated {f.updated_at ? new Date(f.updated_at as string).toLocaleString() : "—"}
								</span>
							</div>
							{f.birthday ? (
								<p className="text-3 text-gray-11">Birthday: {String(f.birthday)}</p>
							) : null}
							{Array.isArray(f.accounts) && f.accounts.length > 0 ? (
								<div className="text-3 text-gray-11">
									<span className="font-medium text-gray-12">Accounts: </span>
									{f.accounts.map((a, i) => (
										<span key={(a.id as string | undefined) ?? `${a.handle ?? ""}-${a.url ?? ""}-${i}`} className="mr-2">
											{(a.platform as { name?: string } | null)?.name ?? "Platform"}
											{a.handle ? ` @${a.handle}` : ""}
											{a.url ? (
												<a href={a.url} className="underline ml-1" target="_blank" rel="noreferrer">
													link
												</a>
											) : null}
										</span>
									))}
								</div>
							) : null}
							{Array.isArray(f.emails) && f.emails.length > 0 ? (
								<p className="text-3 text-gray-11">
									<span className="font-medium text-gray-12">Email: </span>
									{f.emails.map((e: { email?: string }) => e.email).filter(Boolean).join(", ")}
								</p>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
