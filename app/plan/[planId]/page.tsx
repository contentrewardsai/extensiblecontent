import Link from "next/link";
import { getPlanWithDetails, parsePlanId } from "@/lib/promotion-plan";
import { getServiceSupabase } from "@/lib/supabase-service";
import { PlanClient } from "./plan-client";

interface PlanPageProps {
	params: Promise<{ planId: string }>;
}

/**
 * Public, link-shareable promotion plan page.
 *
 *   /plan/<slug>
 *
 * Anyone who knows the slug can view the plan and contribute (comments,
 * platforms, content pieces). Only the admin who created the plan can
 * edit plan-level fields and choose the ShotStack template that loads
 * into the Fabric.js canvas at the bottom.
 *
 * The server component does the initial fetch so the page is fully
 * SSR-friendly; the client component takes over for interaction and
 * Whop OAuth (sign in to claim/edit a plan).
 */
export default async function PlanPage({ params }: PlanPageProps) {
	const { planId: rawPlanId } = await params;
	const parsed = parsePlanId(rawPlanId);
	if (!parsed.ok) {
		return <PlanIdError message={parsed.error} />;
	}

	let initialDetail: Awaited<ReturnType<typeof getPlanWithDetails>> = null;
	try {
		const supabase = getServiceSupabase();
		initialDetail = await getPlanWithDetails(supabase, parsed.id);
	} catch (err) {
		// Supabase not configured locally → render the client shell anyway so
		// the developer sees a useful error rather than a Next 500 page.
		console.error("[/plan/[planId]] failed to load plan:", err);
	}

	return <PlanClient planId={parsed.id} initialDetail={initialDetail} />;
}

function PlanIdError({ message }: { message: string }) {
	return (
		<div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
			<div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
				<h1 className="text-xl font-bold text-slate-800 mb-2">Invalid plan link</h1>
				<p className="text-sm text-slate-600 mb-6">{message}</p>
				<Link
					href="/"
					className="inline-block rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2 text-sm font-semibold transition-colors"
				>
					Back to home
				</Link>
			</div>
		</div>
	);
}
