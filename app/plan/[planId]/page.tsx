import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getPlanWithDetails, parsePlanId } from "@/lib/promotion-plan";
import { getServiceSupabase } from "@/lib/supabase-service";
import "../plan.css";
import { PlanClient } from "./plan-client";

interface PlanPageProps {
	params: Promise<{ planId: string }>;
}

async function getBrandName(): Promise<string> {
	const host =
		(await headers())
			.get("host")
			?.replace(/:\d+$/, "")
			.toLowerCase() ?? "";
	return host.includes("contentrewardsai.com") ||
		host.includes("contentrewardsapp.com")
		? "Content Rewards AI"
		: "Extensible Content";
}

function planTitleFallback(brand: string): string {
	return `${brand} - Promotion Plan`;
}

function buildPlanDocumentTitle(displayTitle: unknown, brand: string): string {
	const trimmed = typeof displayTitle === "string" ? displayTitle.trim() : "";
	if (!trimmed) return planTitleFallback(brand);
	return `${brand} - ${trimmed}`;
}

export async function generateMetadata({ params }: PlanPageProps): Promise<Metadata> {
	const brand = await getBrandName();
	const { planId: rawPlanId } = await params;
	const parsed = parsePlanId(rawPlanId);
	if (!parsed.ok) {
		return { title: planTitleFallback(brand) };
	}

	try {
		const supabase = getServiceSupabase();
		const { data: row } = await supabase
			.from("promotion_plans")
			.select("title")
			.eq("id", parsed.id)
			.maybeSingle();
		return { title: buildPlanDocumentTitle(row?.title, brand) };
	} catch {
		return { title: planTitleFallback(brand) };
	}
}

/**
 * Public, link-shareable promotion plan page.
 *
 *   /plan/<slug>
 *
 * Fully open document — anyone who knows the slug can create the plan
 * (if it doesn't exist yet), edit every field, add platforms / content
 * / comments, approve or reject content, and choose a ShotStack
 * template for the Fabric.js canvas at the bottom. There is no login
 * and no admin concept; the only thing the API does NOT expose is a
 * delete-the-plan path.
 *
 * The server component does the initial fetch so the page is
 * SSR-friendly; the client component takes over for interaction.
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
		<div
			data-plan-root
			className="min-h-screen bg-slate-50 flex items-center justify-center p-8"
		>
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
