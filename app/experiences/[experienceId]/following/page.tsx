import { requireExperienceContext } from "@/lib/experience-context";
import { listFollowingWithJoins } from "@/lib/queries/following";
import { getServiceSupabase } from "@/lib/supabase-service";
import { FollowingEditor } from "./following-editor";

export default async function FollowingPage({ params }: { params: Promise<{ experienceId: string }> }) {
	const { experienceId } = await params;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	const [listResult, platformsResult] = await Promise.all([
		listFollowingWithJoins(supabase, internalUserId).catch(() => null),
		supabase.from("platforms").select("id, name, slug").order("name", { ascending: true }),
	]);

	if (!listResult) {
		return <p className="text-3 text-red-11">Could not load following.</p>;
	}

	const platforms = (platformsResult.data ?? []).map((p) => ({
		id: p.id as string,
		name: p.name as string,
		slug: p.slug as string,
	}));

	return (
		<div className="flex flex-col gap-5">
			<div>
				<h2 className="text-6 font-bold text-gray-12">Following</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					Manage the same contacts as in the{" "}
					<a
						href="https://github.com/contentrewardsai/ExtensibleContentExtension"
						className="text-gray-12 underline"
						target="_blank"
						rel="noreferrer"
					>
						Chrome extension
					</a>
					: collapsible sections per person, social accounts, emails, phones, addresses, and notes. Changes save to your
					account and sync with the extension API.
				</p>
			</div>

			<FollowingEditor experienceId={experienceId} initialList={listResult} platforms={platforms} />
		</div>
	);
}
