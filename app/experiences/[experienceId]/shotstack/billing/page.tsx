import Link from "next/link";
import { requireExperienceContext } from "@/lib/experience-context";
import { getSpendableCredits, listLedgerEntries } from "@/lib/shotstack-ledger";
import { getServiceSupabase } from "@/lib/supabase-service";

const PAGE_SIZE = 100;

const KIND_LABELS: Record<string, string> = {
	grant: "Subscription credit",
	debit: "Render",
	expiry: "Expired (rolled off)",
	adjustment: "Adjustment",
};

const KIND_BADGES: Record<string, string> = {
	grant: "bg-green-a3 text-green-11",
	debit: "bg-gray-a3 text-gray-11",
	expiry: "bg-red-a3 text-red-11",
	adjustment: "bg-blue-a3 text-blue-11",
};

function fmtDate(d: string | null | undefined): string {
	if (!d) return "—";
	return new Date(d).toLocaleString();
}

function fmtCredits(n: number | string): string {
	const v = Number(n);
	if (!Number.isFinite(v)) return "—";
	const sign = v > 0 ? "+" : "";
	return `${sign}${v.toFixed(v % 1 === 0 ? 0 : 2)}`;
}

export default async function ShotstackBillingPage({
	params,
	searchParams,
}: {
	params: Promise<{ experienceId: string }>;
	searchParams: Promise<{ page?: string }>;
}) {
	const { experienceId } = await params;
	const { page: pageParam } = await searchParams;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();
	const pageNum = Math.max(1, Number(pageParam ?? "1") || 1);
	const offset = (pageNum - 1) * PAGE_SIZE;

	const [entries, balance] = await Promise.all([
		listLedgerEntries(supabase, internalUserId, { limit: PAGE_SIZE + 1, offset }),
		getSpendableCredits(supabase, internalUserId),
	]);

	const hasNext = entries.length > PAGE_SIZE;
	const visible = entries.slice(0, PAGE_SIZE);

	// Pre-fetch render output URLs so a debit row can link to the saved
	// generation. We resolve only the renders referenced on this page.
	const renderIds = visible
		.map((e) => e.shotstack_render_id)
		.filter((id): id is string => !!id);
	let renderUrls: Record<string, string | null> = {};
	if (renderIds.length > 0) {
		const { data: renders } = await supabase
			.from("shotstack_renders")
			.select("shotstack_render_id, output_url")
			.in("shotstack_render_id", renderIds)
			.eq("user_id", internalUserId);
		renderUrls = Object.fromEntries(
			(renders ?? []).map((r) => [r.shotstack_render_id as string, (r.output_url as string | null) ?? null]),
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h2 className="text-6 font-bold text-gray-12">ShotStack billing</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					Every credit grant and render debit, newest first. Credits granted by a subscription stay spendable
					for <strong>3 months</strong> (the rollover window); whatever's left after that is automatically
					offset by an <em>Expired (rolled off)</em> entry that links back to the original grant, so you can
					always see exactly how your balance was spent or rolled off.
				</p>
				<p className="text-2 text-gray-10 mt-2">
					<Link href={`/experiences/${experienceId}/shotstack`} className="underline text-gray-12">
						← Back to ShotStack
					</Link>
				</p>
			</div>

			<section className="border border-gray-a4 rounded-lg p-4 bg-gray-a2 flex flex-wrap items-center gap-6">
				<div>
					<p className="text-2 text-gray-10 uppercase tracking-wide">Spendable balance</p>
					<p className="text-6 font-semibold text-gray-12 mt-1">
						{balance.toFixed(2)} <span className="text-3 font-normal text-gray-10">credits</span>
					</p>
					<p className="text-2 text-gray-10 mt-1">1 credit = 1 minute of render</p>
				</div>
			</section>

			{visible.length === 0 ? (
				<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-6 bg-gray-a2">
					No billing history yet. Render a video or upgrade your plan to see entries here.
				</p>
			) : (
				<div className="overflow-x-auto border border-gray-a4 rounded-lg">
					<table className="w-full text-left text-3">
						<thead className="bg-gray-a3 border-b border-gray-a4">
							<tr>
								<th className="p-3 font-semibold text-gray-12">When</th>
								<th className="p-3 font-semibold text-gray-12">Type</th>
								<th className="p-3 font-semibold text-gray-12">Description</th>
								<th className="p-3 font-semibold text-gray-12 text-right">Credits</th>
								<th className="p-3 font-semibold text-gray-12">Expires</th>
								<th className="p-3 font-semibold text-gray-12">Output</th>
							</tr>
						</thead>
						<tbody>
							{visible.map((e) => {
								const badge = KIND_BADGES[e.kind] ?? "bg-gray-a3 text-gray-11";
								const label = KIND_LABELS[e.kind] ?? e.kind;
								const renderUrl = e.shotstack_render_id
									? renderUrls[e.shotstack_render_id] ?? null
									: null;
								const credits = Number(e.credits);
								const creditTone =
									credits > 0 ? "text-green-11" : credits < 0 ? "text-red-11" : "text-gray-11";
								return (
									<tr key={e.id} className="border-b border-gray-a4 last:border-0">
										<td className="p-3 text-gray-11 whitespace-nowrap">{fmtDate(e.created_at)}</td>
										<td className="p-3">
											<span className={`text-2 px-2 py-0.5 rounded-md ${badge}`}>{label}</span>
										</td>
										<td className="p-3 text-gray-11">
											<div>{e.description ?? "—"}</div>
											{e.shotstack_render_id ? (
												<div className="text-2 text-gray-10 font-mono mt-1 break-all">
													render {e.shotstack_render_id}
												</div>
											) : null}
											{e.whop_payment_id ? (
												<div className="text-2 text-gray-10 mt-1">
													Whop payment <span className="font-mono">{e.whop_payment_id}</span>
												</div>
											) : null}
											{e.kind === "expiry" && e.source_grant_id ? (
												<div className="text-2 text-gray-10 mt-1 font-mono break-all">
													offsets grant {e.source_grant_id}
												</div>
											) : null}
										</td>
										<td className={`p-3 text-right font-mono ${creditTone}`}>{fmtCredits(credits)}</td>
										<td className="p-3 text-gray-11 whitespace-nowrap">
											{e.kind === "grant" ? fmtDate(e.expires_at) : "—"}
										</td>
										<td className="p-3">
											{renderUrl ? (
												<a
													href={renderUrl}
													target="_blank"
													rel="noopener noreferrer"
													className="underline text-gray-12"
												>
													Open
												</a>
											) : (
												<span className="text-gray-10">—</span>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{(pageNum > 1 || hasNext) ? (
				<nav className="flex items-center justify-between text-3 text-gray-11">
					{pageNum > 1 ? (
						<Link
							href={`/experiences/${experienceId}/shotstack/billing?page=${pageNum - 1}`}
							className="underline text-gray-12"
						>
							← Newer
						</Link>
					) : (
						<span />
					)}
					{hasNext ? (
						<Link
							href={`/experiences/${experienceId}/shotstack/billing?page=${pageNum + 1}`}
							className="underline text-gray-12"
						>
							Older →
						</Link>
					) : (
						<span />
					)}
				</nav>
			) : null}
		</div>
	);
}
