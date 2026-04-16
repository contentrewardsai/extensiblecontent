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

	return <FollowingEditor experienceId={experienceId} initialList={listResult} platforms={platforms} />;
}
