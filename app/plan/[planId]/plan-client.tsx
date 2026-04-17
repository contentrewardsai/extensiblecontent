"use client";

import {
	AtSign,
	Bird,
	Briefcase,
	Calendar,
	Camera,
	Cloud,
	DollarSign,
	Globe,
	type LucideIcon,
	MessageCircle,
	Music,
	Pin,
	Plus,
	Send,
	Smartphone,
	Store,
	Target,
	ThumbsDown,
	ThumbsUp,
	Trash2,
	TrendingUp,
	Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	ALLOWED_MEDIA_KINDS,
	ALLOWED_OBJECTIVES,
	detectMediaKind,
	type MediaKind,
	type PromotionPlanCommentRow,
	type PromotionPlanContentRow,
	type PromotionPlanDetail,
	type PromotionPlanPlatformRow,
	type PromotionPlanRow,
} from "@/lib/promotion-plan";

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------

const PLATFORMS: ReadonlyArray<{ name: string; icon: LucideIcon; type: "vertical" | "feed" | "visual" }> = [
	{ name: "TikTok", icon: Music, type: "vertical" },
	{ name: "Instagram", icon: Camera, type: "vertical" },
	{ name: "YouTube", icon: Video, type: "vertical" },
	{ name: "LinkedIn", icon: Briefcase, type: "feed" },
	{ name: "Facebook", icon: Globe, type: "feed" },
	{ name: "X", icon: Bird, type: "feed" },
	{ name: "Threads", icon: AtSign, type: "feed" },
	{ name: "Pinterest", icon: Pin, type: "visual" },
	{ name: "Reddit", icon: MessageCircle, type: "feed" },
	{ name: "Google Business", icon: Store, type: "feed" },
	{ name: "Bluesky", icon: Cloud, type: "feed" },
];

// ---------------------------------------------------------------------------
// Detail helpers
// ---------------------------------------------------------------------------

interface PlanApiResponse extends PromotionPlanDetail {
	isAdmin: boolean;
	viewer: { user_id: string; email: string } | null;
}

const DEFAULT_ESTIMATES = { views: 25000, clicks: 1200, lpViews: 600, leads: 45, sales: 3 };

function ensureEstimates(estimates: Record<string, number> | undefined | null): Record<string, number> {
	const merged: Record<string, number> = { ...DEFAULT_ESTIMATES };
	for (const [k, v] of Object.entries(estimates ?? {})) {
		if (Number.isFinite(Number(v))) merged[k] = Number(v);
	}
	return merged;
}

const jsonHeaders = { "Content-Type": "application/json" } as const;

/**
 * Translate a YouTube / Vimeo / generic URL to something safe to drop
 * into an `<iframe src>`. Returns the original URL when we can't
 * recognise the host (the iframe will simply 404 / refuse — but the
 * raw URL is also surfaced in the editor so the user can fix it).
 */
function toEmbedSrc(url: string): string {
	const u = url.trim();
	if (!u) return "";
	// youtu.be/<id>
	const ytShort = u.match(/^https?:\/\/youtu\.be\/([\w-]{6,})/i);
	if (ytShort) return `https://www.youtube.com/embed/${ytShort[1]}`;
	// youtube.com/watch?v=<id>
	const ytWatch = u.match(/[?&]v=([\w-]{6,})/);
	if (/youtube\.com\/watch/i.test(u) && ytWatch) {
		return `https://www.youtube.com/embed/${ytWatch[1]}`;
	}
	// already an /embed/ URL
	if (/youtube\.com\/embed\//i.test(u)) return u;
	// vimeo.com/<id>
	const vimeo = u.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i);
	if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
	if (/player\.vimeo\.com\/video\//i.test(u)) return u;
	return u;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PlanClientProps {
	planId: string;
	initialDetail: PromotionPlanDetail | null;
}

export function PlanClient({ planId, initialDetail }: PlanClientProps) {
	const [detail, setDetail] = useState<PromotionPlanDetail | null>(initialDetail);
	const [planNotFound, setPlanNotFound] = useState(initialDetail === null);
	const [creating, setCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);

	const refreshDetail = useCallback(async () => {
		try {
			const res = await fetch(`/api/plan/${planId}`, { cache: "no-store" });
			if (res.status === 404) {
				setPlanNotFound(true);
				setDetail(null);
				return;
			}
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as PlanApiResponse;
			setDetail({
				plan: data.plan,
				platforms: data.platforms,
				content: data.content,
				planComments: data.planComments,
				contentComments: data.contentComments,
				template: data.template,
			});
			setPlanNotFound(false);
		} catch (err) {
			console.error("[plan] refreshDetail failed:", err);
		}
	}, [planId]);

	const createPlan = useCallback(async () => {
		setCreating(true);
		setCreateError(null);
		try {
			const res = await fetch(`/api/plan/${planId}`, { method: "PUT" });
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error ?? `Failed to create plan (HTTP ${res.status})`);
			}
			await refreshDetail();
		} catch (err) {
			setCreateError(err instanceof Error ? err.message : "Failed to create plan");
		} finally {
			setCreating(false);
		}
	}, [planId, refreshDetail]);

	if (planNotFound) {
		return (
			<NotFoundView
				planId={planId}
				creating={creating}
				createError={createError}
				onCreate={createPlan}
			/>
		);
	}

	if (!detail) {
		return (
			<div className="min-h-screen bg-slate-50 flex items-center justify-center">
				<p className="text-slate-500">Loading plan…</p>
			</div>
		);
	}

	return (
		<PlanView
			planId={planId}
			detail={detail}
			setDetail={setDetail}
			refreshDetail={refreshDetail}
		/>
	);
}

// ---------------------------------------------------------------------------
// "Plan does not exist" landing
// ---------------------------------------------------------------------------

interface NotFoundProps {
	planId: string;
	creating: boolean;
	createError: string | null;
	onCreate: () => void;
}

function NotFoundView({ planId, creating, createError, onCreate }: NotFoundProps) {
	return (
		<div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
			<div className="max-w-lg w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
				<div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
					<Target className="w-6 h-6" />
				</div>
				<h1 className="text-xl font-bold text-slate-800 mb-1">No plan at /plan/{planId}</h1>
				<p className="text-sm text-slate-600 mb-6">
					This slug is available. Click below to spin up the plan — anyone with the link can then
					view it, edit it, comment, and approve / reject content.
				</p>
				{createError ? <p className="text-sm text-red-600 mb-4">{createError}</p> : null}
				<button
					type="button"
					onClick={onCreate}
					disabled={creating}
					className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold rounded-lg px-5 py-2.5"
				>
					{creating ? "Creating…" : "Create this plan"}
				</button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

interface PlanViewProps {
	planId: string;
	detail: PromotionPlanDetail;
	setDetail: React.Dispatch<React.SetStateAction<PromotionPlanDetail | null>>;
	refreshDetail: () => Promise<void>;
}

function PlanView({ planId, detail, setDetail, refreshDetail }: PlanViewProps) {
	const { plan } = detail;

	// ---- Plan-level edits ----------------------------------------------
	const patchPlan = useCallback(
		async (patch: Partial<PromotionPlanRow>) => {
			const res = await fetch(`/api/plan/${planId}`, {
				method: "PATCH",
				headers: jsonHeaders,
				body: JSON.stringify(patch),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				alert(body.error ?? `Failed to save (HTTP ${res.status})`);
				return;
			}
			const data = (await res.json()) as PlanApiResponse;
			setDetail({
				plan: data.plan,
				platforms: data.platforms,
				content: data.content,
				planComments: data.planComments,
				contentComments: data.contentComments,
				template: data.template,
			});
		},
		[planId, setDetail],
	);

	// ---- Comments -------------------------------------------------------
	const [planCommentDraft, setPlanCommentDraft] = useState("");
	const submitPlanComment = useCallback(async () => {
		const text = planCommentDraft.trim();
		if (!text) return;
		const res = await fetch(`/api/plan/${planId}/comments`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ body: text }),
		});
		if (!res.ok) return;
		const row = (await res.json()) as PromotionPlanCommentRow;
		setPlanCommentDraft("");
		setDetail((prev) => (prev ? { ...prev, planComments: [...prev.planComments, row] } : prev));
	}, [planCommentDraft, planId, setDetail]);

	const submitContentComment = useCallback(
		async (contentId: string, kind: "post" | "ad", body: string) => {
			const text = body.trim();
			if (!text) return;
			const res = await fetch(`/api/plan/${planId}/comments`, {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({ body: text, content_id: contentId, kind }),
			});
			if (!res.ok) return;
			const row = (await res.json()) as PromotionPlanCommentRow;
			setDetail((prev) => {
				if (!prev) return prev;
				const next = { ...prev.contentComments };
				const bucket = (next[contentId] = { ...(next[contentId] ?? { post: [], ad: [] }) });
				if (kind === "post") bucket.post = [...bucket.post, row];
				else bucket.ad = [...bucket.ad, row];
				return { ...prev, contentComments: next };
			});
		},
		[planId, setDetail],
	);

	// ---- Platforms ------------------------------------------------------
	const addPlatform = useCallback(
		async (name: string) => {
			const res = await fetch(`/api/plan/${planId}/platforms`, {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({ name, followers: 0 }),
			});
			if (!res.ok) return;
			const row = (await res.json()) as PromotionPlanPlatformRow;
			setDetail((prev) => (prev ? { ...prev, platforms: [...prev.platforms, row] } : prev));
		},
		[planId, setDetail],
	);

	const removePlatform = useCallback(
		async (id: string) => {
			if (!confirm("Remove this platform and all of its content?")) return;
			const res = await fetch(`/api/plan/${planId}/platforms/${id}`, { method: "DELETE" });
			if (!res.ok) return;
			setDetail((prev) =>
				prev
					? {
							...prev,
							platforms: prev.platforms.filter((p) => p.id !== id),
							content: prev.content.filter((c) => c.platform_id !== id),
						}
					: prev,
			);
		},
		[planId, setDetail],
	);

	const updatePlatform = useCallback(
		async (id: string, patch: { name?: string; followers?: number }) => {
			const res = await fetch(`/api/plan/${planId}/platforms/${id}`, {
				method: "PATCH",
				headers: jsonHeaders,
				body: JSON.stringify(patch),
			});
			if (!res.ok) return;
			const row = (await res.json()) as PromotionPlanPlatformRow;
			setDetail((prev) =>
				prev
					? { ...prev, platforms: prev.platforms.map((p) => (p.id === id ? row : p)) }
					: prev,
			);
		},
		[planId, setDetail],
	);

	// ---- Content --------------------------------------------------------
	const addContent = useCallback(
		async (platformId: string) => {
			const res = await fetch(`/api/plan/${planId}/content`, {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({ platform_id: platformId, is_post: true, is_ad: false }),
			});
			if (!res.ok) return;
			const row = (await res.json()) as PromotionPlanContentRow;
			setDetail((prev) => (prev ? { ...prev, content: [...prev.content, row] } : prev));
		},
		[planId, setDetail],
	);

	const updateContent = useCallback(
		async (id: string, patch: Partial<PromotionPlanContentRow>) => {
			const res = await fetch(`/api/plan/${planId}/content/${id}`, {
				method: "PATCH",
				headers: jsonHeaders,
				body: JSON.stringify(patch),
			});
			if (!res.ok) return;
			const row = (await res.json()) as PromotionPlanContentRow;
			setDetail((prev) =>
				prev ? { ...prev, content: prev.content.map((c) => (c.id === id ? row : c)) } : prev,
			);
		},
		[planId, setDetail],
	);

	const removeContent = useCallback(
		async (id: string) => {
			if (!confirm("Remove this content piece?")) return;
			const res = await fetch(`/api/plan/${planId}/content/${id}`, { method: "DELETE" });
			if (!res.ok) return;
			setDetail((prev) =>
				prev ? { ...prev, content: prev.content.filter((c) => c.id !== id) } : prev,
			);
		},
		[planId, setDetail],
	);

	// ---- Recommendations (derived) -------------------------------------
	const recommendations = useMemo(() => {
		const recs: { type: "ad" | "software"; message: string; detail: string }[] = [];
		for (const p of detail.platforms) {
			if (p.followers < 200) {
				const suggested = Math.max(10, Math.min(20, plan.daily_budget / 2));
				recs.push({
					type: "ad",
					message: `Audience Building for ${p.name}`,
					detail: `Current followers (${p.followers}) are below 200. We recommend allocating $${suggested.toFixed(2)}/day from your budget towards an ad campaign specifically for page likes/followers to build an initial foundation.`,
				});
			}
		}
		const counts: Record<string, number> = {};
		for (const p of detail.platforms) counts[p.name] = (counts[p.name] ?? 0) + 1;
		const maxProfiles = Math.max(0, ...Object.values(counts));
		if (maxProfiles > 0) {
			let cost = 0;
			let desc = "";
			if (maxProfiles === 1) {
				cost = 10;
				desc = "up to 1 profile per platform";
			} else if (maxProfiles <= 10) {
				cost = 40;
				desc = "up to 10 profiles per platform";
			} else {
				cost = 100;
				desc = "up to 25 profiles per platform";
			}
			recs.push({
				type: "software",
				message: "Automated Posting Setup",
				detail: `Based on your profile configuration (${maxProfiles} max per platform), we suggest setting up automated posting. This requires a software budget of $${cost}/mo (${desc}).`,
			});
		}
		return recs;
	}, [detail.platforms, plan.daily_budget]);

	const totalBudgetLabel = useMemo(() => {
		if (plan.budget_type === "monthly") {
			return `$${(plan.daily_budget * 30).toLocaleString()}/month`;
		}
		if (!plan.end_date) return "$0";
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const [y, m, d] = plan.end_date.split("-").map(Number);
		const end = new Date(y, m - 1, d);
		const diffDays = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) + 1;
		const days = Math.max(0, diffDays);
		return `$${(plan.daily_budget * days).toLocaleString()}`;
	}, [plan.budget_type, plan.daily_budget, plan.end_date]);

	const estimates = ensureEstimates(plan.estimates);

	return (
		<div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-800">
			<div className="max-w-6xl mx-auto space-y-8">
				<HeaderBar planId={planId} onRefresh={() => refreshDetail()} />

				<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
					<div className="lg:col-span-2 space-y-8">
						<ExecutiveSummary
							intro={plan.intro}
							onSaveIntro={(v) => patchPlan({ intro: v })}
							planComments={detail.planComments}
							draft={planCommentDraft}
							setDraft={setPlanCommentDraft}
							onSubmitComment={submitPlanComment}
						/>

						<ObjectiveBudget
							plan={plan}
							onPatch={patchPlan}
							totalBudgetLabel={totalBudgetLabel}
						/>

						<ProjectedOutcomes
							estimates={estimates}
							dailyBudget={plan.daily_budget}
							onPatch={(next) => patchPlan({ estimates: next })}
						/>
					</div>

					<aside className="space-y-8">
						<RecommendationsPanel recommendations={recommendations} />
					</aside>
				</div>

				<PlatformsSection
					detail={detail}
					objective={plan.objective}
					dailyBudget={plan.daily_budget}
					addPlatform={addPlatform}
					removePlatform={removePlatform}
					updatePlatform={updatePlatform}
					addContent={addContent}
					updateContent={updateContent}
					removeContent={removeContent}
					submitContentComment={submitContentComment}
				/>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function HeaderBar({ planId, onRefresh }: { planId: string; onRefresh: () => void }) {
	return (
		<div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-3">
				<div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-black text-lg">EC</div>
				<div>
					<p className="text-xs uppercase tracking-wider text-slate-400">Promotion Plan</p>
					<h1 className="text-xl font-bold text-slate-800 leading-tight">/plan/{planId}</h1>
				</div>
			</div>
			<div className="flex items-center gap-3">
				<span className="text-xs text-slate-500">
					Open document — anyone with the link can edit, comment, and approve.
				</span>
				<button
					type="button"
					onClick={onRefresh}
					className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg"
				>
					Refresh
				</button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Executive summary + plan-level comments
// ---------------------------------------------------------------------------

interface ExecutiveSummaryProps {
	intro: string;
	onSaveIntro: (v: string) => Promise<void>;
	planComments: PromotionPlanCommentRow[];
	draft: string;
	setDraft: (v: string) => void;
	onSubmitComment: () => Promise<void>;
}

function ExecutiveSummary(props: ExecutiveSummaryProps) {
	const { intro, onSaveIntro, planComments, draft, setDraft, onSubmitComment } = props;
	const [localIntro, setLocalIntro] = useState(intro);
	useEffect(() => setLocalIntro(intro), [intro]);

	return (
		<section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
			<h2 className="text-lg font-bold flex items-center gap-2 mb-4 border-b pb-2">
				<Target className="w-5 h-5 text-emerald-500" /> Executive Summary
			</h2>
			<div className="space-y-6">
				<div>
					<label className="block text-sm font-semibold text-slate-700 mb-1">Our Recommendation</label>
					<textarea
						className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-sm"
						rows={3}
						value={localIntro}
						onChange={(e) => setLocalIntro(e.target.value)}
						onBlur={() => {
							if (localIntro !== intro) onSaveIntro(localIntro);
						}}
					/>
				</div>
				<div>
					<label className="block text-sm font-semibold text-slate-700 mb-3 border-b pb-2">
						Comments / Notes
					</label>
					{planComments.length > 0 ? (
						<div className="space-y-3 mb-4 max-h-60 overflow-y-auto pr-2">
							{planComments.map((c) => (
								<CommentBubble key={c.id} comment={c} accent="emerald" />
							))}
						</div>
					) : (
						<p className="text-xs italic text-slate-400 mb-4">No comments yet — be the first.</p>
					)}
					<div className="flex flex-col gap-3">
						<textarea
							className="w-full p-3 border border-emerald-100 bg-emerald-50/30 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-sm placeholder-emerald-300"
							rows={2}
							placeholder="Add your thoughts or requested changes…"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
						/>
						<button
							type="button"
							onClick={() => onSubmitComment()}
							className="self-end inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold"
						>
							<Send className="w-4 h-4" /> Submit Comment
						</button>
					</div>
				</div>
			</div>
		</section>
	);
}

function CommentBubble({
	comment,
	accent,
}: {
	comment: PromotionPlanCommentRow;
	accent: "emerald" | "blue";
}) {
	const accentClass = accent === "emerald" ? "text-emerald-600" : "text-blue-600";
	return (
		<div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
			<p className={`text-xs font-semibold mb-1 ${accentClass}`}>
				{comment.author_name} · {new Date(comment.created_at).toLocaleString()}
			</p>
			<p className="text-sm text-slate-700 whitespace-pre-wrap">{comment.body}</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Objective + budget
// ---------------------------------------------------------------------------

interface ObjectiveBudgetProps {
	plan: PromotionPlanRow;
	onPatch: (patch: Partial<PromotionPlanRow>) => Promise<void>;
	totalBudgetLabel: string;
}

function ObjectiveBudget({ plan, onPatch, totalBudgetLabel }: ObjectiveBudgetProps) {
	const [localObjDesc, setLocalObjDesc] = useState(plan.objective_description);
	const [localBudget, setLocalBudget] = useState<number>(plan.daily_budget);
	useEffect(() => setLocalObjDesc(plan.objective_description), [plan.objective_description]);
	useEffect(() => setLocalBudget(plan.daily_budget), [plan.daily_budget]);

	return (
		<section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
			<h2 className="text-lg font-bold flex items-center gap-2 mb-4 border-b pb-2">
				<DollarSign className="w-5 h-5 text-emerald-500" /> Objective & Budgeting
			</h2>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div className="space-y-4">
					<div>
						<label className="block text-sm font-semibold text-slate-700 mb-1">Primary Objective</label>
						<select
							className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
							value={plan.objective}
							onChange={(e) => onPatch({ objective: e.target.value })}
						>
							{ALLOWED_OBJECTIVES.map((obj) => (
								<option key={obj} value={obj}>
									{obj}
								</option>
							))}
						</select>
					</div>
					<div>
						<label className="block text-sm font-semibold text-slate-700 mb-1">Objective Context</label>
						<textarea
							className="w-full p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
							rows={3}
							value={localObjDesc}
							onChange={(e) => setLocalObjDesc(e.target.value)}
							onBlur={() => {
								if (localObjDesc !== plan.objective_description) {
									onPatch({ objective_description: localObjDesc });
								}
							}}
						/>
					</div>
				</div>
				<div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
					<div>
						<label className="block text-sm font-semibold text-slate-700 mb-1">Daily Ad Budget</label>
						<div className="flex items-center gap-2">
							<span className="text-slate-500 font-medium">$</span>
							<input
								type="number"
								min={0}
								step={1}
								className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
								value={localBudget}
								onChange={(e) => setLocalBudget(Number(e.target.value) || 0)}
								onBlur={() => {
									if (localBudget !== plan.daily_budget) onPatch({ daily_budget: localBudget });
								}}
							/>
							<span className="text-slate-500 text-sm">/ day</span>
						</div>
					</div>
					<div>
						<label className="block text-sm font-semibold text-slate-700 mb-1">Duration</label>
						<div className="flex gap-4 mb-2">
							<label className="flex items-center gap-2 text-sm cursor-pointer">
								<input
									type="radio"
									name="budgetType"
									value="monthly"
									checked={plan.budget_type === "monthly"}
									onChange={() => onPatch({ budget_type: "monthly" })}
									className="text-emerald-500 focus:ring-emerald-500"
								/>
								Ongoing Monthly
							</label>
							<label className="flex items-center gap-2 text-sm cursor-pointer">
								<input
									type="radio"
									name="budgetType"
									value="fixed"
									checked={plan.budget_type === "fixed"}
									onChange={() => onPatch({ budget_type: "fixed" })}
									className="text-emerald-500 focus:ring-emerald-500"
								/>
								Fixed End Date
							</label>
						</div>
						{plan.budget_type === "fixed" && (
							<input
								type="date"
								className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
								value={plan.end_date ?? ""}
								onChange={(e) => onPatch({ end_date: e.target.value || null })}
							/>
						)}
					</div>
					<div className="pt-2 border-t border-slate-200">
						<p className="text-sm text-slate-500">Total Projected Spend:</p>
						<p className="text-lg font-bold text-emerald-600">{totalBudgetLabel}</p>
					</div>
				</div>
			</div>
		</section>
	);
}

// ---------------------------------------------------------------------------
// Projected outcomes
// ---------------------------------------------------------------------------

interface ProjectedOutcomesProps {
	estimates: Record<string, number>;
	dailyBudget: number;
	onPatch: (next: Record<string, number>) => Promise<void>;
}

function ProjectedOutcomes({ estimates, dailyBudget, onPatch }: ProjectedOutcomesProps) {
	const [local, setLocal] = useState(estimates);
	useEffect(() => setLocal(estimates), [estimates]);
	const update = (key: string, value: number) => setLocal((prev) => ({ ...prev, [key]: value }));
	const flush = () => {
		const changed = Object.keys(local).some((k) => local[k] !== estimates[k]);
		if (changed) onPatch(local);
	};
	return (
		<section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
			<h2 className="text-lg font-bold flex items-center gap-2 mb-4 border-b pb-2">
				<TrendingUp className="w-5 h-5 text-emerald-500" /> Projected Outcomes
			</h2>
			<p className="text-xs text-slate-500 mb-4 leading-relaxed">
				These estimates are based on your selected budget of ${dailyBudget}/day and current
				objective. Adjust freely — saved on blur.
			</p>
			<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
				{Object.entries(local).map(([key, value]) => (
					<div
						key={key}
						className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex flex-col group"
					>
						<span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
							{key.replace(/([A-Z])/g, " $1").trim()}
						</span>
						<input
							type="number"
							className="w-full p-1 text-lg font-bold text-slate-800 bg-transparent border-b-2 border-transparent focus:border-emerald-500 outline-none transition-all group-hover:bg-white rounded"
							value={value}
							onChange={(e) => update(key, Number(e.target.value) || 0)}
							onBlur={flush}
						/>
					</div>
				))}
			</div>
		</section>
	);
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function RecommendationsPanel({
	recommendations,
}: {
	recommendations: { type: "ad" | "software"; message: string; detail: string }[];
}) {
	return (
		<section className="bg-slate-800 text-white p-6 rounded-2xl shadow-lg border border-slate-700 sticky top-8">
			<h2 className="text-lg font-bold flex items-center gap-2 mb-4 text-emerald-400 border-b border-slate-600 pb-2">
				<Target className="w-5 h-5" /> Strategic Insights
			</h2>
			{recommendations.length === 0 ? (
				<p className="text-sm text-slate-400 italic">
					No specific recommendations at this time. Increase your platforms or adjust follower
					counts to see insights.
				</p>
			) : (
				<div className="space-y-4">
					{recommendations.map((rec) => (
						<div
							key={`${rec.type}-${rec.message}`}
							className="bg-slate-700/50 p-4 rounded-xl border border-slate-600"
						>
							<h3 className="font-semibold text-sm flex items-center gap-2 mb-1">
								{rec.type === "ad" ? (
									<TrendingUp className="w-4 h-4 text-emerald-400" />
								) : (
									<Calendar className="w-4 h-4 text-blue-400" />
								)}
								{rec.message}
							</h3>
							<p className="text-xs text-slate-300 leading-relaxed">{rec.detail}</p>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

// ---------------------------------------------------------------------------
// Platforms / Profiles / Content + previews
// ---------------------------------------------------------------------------

interface PlatformsSectionProps {
	detail: PromotionPlanDetail;
	objective: string;
	dailyBudget: number;
	addPlatform: (name: string) => Promise<void>;
	removePlatform: (id: string) => Promise<void>;
	updatePlatform: (id: string, patch: { name?: string; followers?: number }) => Promise<void>;
	addContent: (platformId: string) => Promise<void>;
	updateContent: (id: string, patch: Partial<PromotionPlanContentRow>) => Promise<void>;
	removeContent: (id: string) => Promise<void>;
	submitContentComment: (contentId: string, kind: "post" | "ad", body: string) => Promise<void>;
}

function PlatformsSection(props: PlatformsSectionProps) {
	const {
		detail,
		objective,
		dailyBudget,
		addPlatform,
		removePlatform,
		updatePlatform,
		addContent,
		updateContent,
		removeContent,
		submitContentComment,
	} = props;

	const contentByPlatform = useMemo(() => {
		const m = new Map<string, PromotionPlanContentRow[]>();
		for (const c of detail.content) {
			const arr = m.get(c.platform_id) ?? [];
			arr.push(c);
			m.set(c.platform_id, arr);
		}
		return m;
	}, [detail.content]);

	return (
		<section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
			<div className="flex justify-between items-center mb-6 border-b pb-4">
				<div>
					<h2 className="text-xl font-bold flex items-center gap-2 text-slate-800">
						<Smartphone className="w-6 h-6 text-emerald-500" /> Platforms, Profiles & Previews
					</h2>
					<p className="text-sm text-slate-500 mt-1">
						Anyone with the link can add profiles, edit content, leave notes, and approve / reject.
					</p>
				</div>
				<AddPlatformDropdown onAdd={addPlatform} />
			</div>
			<div className="space-y-8">
				{detail.platforms.length === 0 ? (
					<p className="text-sm text-slate-500 italic text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
						No platforms added yet. Add a profile above to begin.
					</p>
				) : (
					detail.platforms.map((platform, idx) => (
						<PlatformCard
							key={platform.id}
							platform={platform}
							index={idx}
							content={contentByPlatform.get(platform.id) ?? []}
							objective={objective}
							dailyBudget={dailyBudget}
							onRemove={() => removePlatform(platform.id)}
							onUpdate={(patch) => updatePlatform(platform.id, patch)}
							onAddContent={() => addContent(platform.id)}
							onUpdateContent={updateContent}
							onRemoveContent={removeContent}
							commentBuckets={detail.contentComments}
							submitContentComment={submitContentComment}
						/>
					))
				)}
			</div>
		</section>
	);
}

function AddPlatformDropdown({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-1 text-sm bg-emerald-500 text-white px-4 py-2 rounded-lg hover:bg-emerald-600 transition-colors font-medium shadow-sm"
			>
				<Plus className="w-4 h-4" /> Add Profile
			</button>
			{open ? (
				<>
					<button
						type="button"
						className="fixed inset-0 z-40 cursor-default"
						onClick={() => setOpen(false)}
						aria-label="Close menu"
					/>
					<div className="absolute right-0 top-full pt-2 z-50 w-48">
						<div className="bg-white border border-slate-200 shadow-xl rounded-xl py-2">
							{PLATFORMS.map((p) => {
								const Icon = p.icon;
								return (
									<button
										key={p.name}
										type="button"
										onClick={async () => {
											setOpen(false);
											await onAdd(p.name);
										}}
										className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-50 text-left text-sm text-slate-700 transition-colors"
									>
										<Icon className="w-4 h-4 text-slate-400" /> {p.name}
									</button>
								);
							})}
						</div>
					</div>
				</>
			) : null}
		</div>
	);
}

interface PlatformCardProps {
	platform: PromotionPlanPlatformRow;
	index: number;
	content: PromotionPlanContentRow[];
	objective: string;
	dailyBudget: number;
	onRemove: () => void;
	onUpdate: (patch: { name?: string; followers?: number }) => void;
	onAddContent: () => void;
	onUpdateContent: (id: string, patch: Partial<PromotionPlanContentRow>) => Promise<void>;
	onRemoveContent: (id: string) => Promise<void>;
	commentBuckets: PromotionPlanDetail["contentComments"];
	submitContentComment: (contentId: string, kind: "post" | "ad", body: string) => Promise<void>;
}

function PlatformCard(props: PlatformCardProps) {
	const {
		platform,
		index,
		content,
		objective,
		dailyBudget,
		onRemove,
		onUpdate,
		onAddContent,
		onUpdateContent,
		onRemoveContent,
		commentBuckets,
		submitContentComment,
	} = props;
	const platInfo = PLATFORMS.find((p) => p.name === platform.name);
	const Icon = platInfo?.icon ?? Target;
	const [followers, setFollowers] = useState(platform.followers);
	useEffect(() => setFollowers(platform.followers), [platform.followers]);

	return (
		<div className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
			<div className="bg-white p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
				<div className="flex items-center gap-4">
					<div className="bg-emerald-50 p-3 rounded-xl shrink-0">
						<Icon className="w-6 h-6 text-emerald-600" />
					</div>
					<div>
						<p className="font-bold text-lg text-slate-800">
							{platform.name}{" "}
							<span className="text-slate-400 font-normal text-sm ml-2">Profile {index + 1}</span>
						</p>
						<div className="flex items-center gap-2 mt-1">
							<label className="text-xs text-slate-500 font-medium">Followers:</label>
							<input
								type="number"
								className="w-24 p-1 text-sm border-b border-slate-300 bg-transparent outline-none focus:border-emerald-500 focus:ring-0"
								value={followers}
								onChange={(e) => setFollowers(Number(e.target.value) || 0)}
								onBlur={() => {
									if (followers !== platform.followers) onUpdate({ followers });
								}}
							/>
						</div>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={onAddContent}
						className="flex items-center gap-1 text-sm text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors font-medium border border-emerald-100"
					>
						<Plus className="w-4 h-4" /> Add Content Piece
					</button>
					<button
						type="button"
						onClick={onRemove}
						className="text-slate-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 rounded-lg"
						aria-label="Remove platform"
					>
						<Trash2 className="w-5 h-5" />
					</button>
				</div>
			</div>

			<div className="divide-y divide-slate-200">
				{content.map((c, cIdx) => (
					<ContentRow
						key={c.id}
						content={c}
						index={cIdx}
						platformName={platform.name}
						objective={objective}
						dailyBudget={dailyBudget}
						commentBucket={commentBuckets[c.id] ?? { post: [], ad: [] }}
						onUpdate={(patch) => onUpdateContent(c.id, patch)}
						onRemove={() => onRemoveContent(c.id)}
						submitComment={(kind, body) => submitContentComment(c.id, kind, body)}
					/>
				))}
				{content.length === 0 ? (
					<div className="p-8 text-center bg-slate-50/50">
						<p className="text-slate-500 text-sm">
							No content defined for this profile. Click "Add Content Piece" above.
						</p>
					</div>
				) : null}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Content payload editor (title, body, media URL, CTA)
// ---------------------------------------------------------------------------

interface ContentPayloadEditorProps {
	content: PromotionPlanContentRow;
	onUpdate: (patch: Partial<PromotionPlanContentRow>) => Promise<void>;
}

function ContentPayloadEditor({ content, onUpdate }: ContentPayloadEditorProps) {
	const [title, setTitle] = useState(content.title);
	const [body, setBody] = useState(content.body);
	const [mediaUrl, setMediaUrl] = useState(content.media_url);
	const [ctaLabel, setCtaLabel] = useState(content.cta_label);
	const [ctaUrl, setCtaUrl] = useState(content.cta_url);
	useEffect(() => setTitle(content.title), [content.title]);
	useEffect(() => setBody(content.body), [content.body]);
	useEffect(() => setMediaUrl(content.media_url), [content.media_url]);
	useEffect(() => setCtaLabel(content.cta_label), [content.cta_label]);
	useEffect(() => setCtaUrl(content.cta_url), [content.cta_url]);

	return (
		<div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
			<div>
				<label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
					Title / Hook
				</label>
				<input
					type="text"
					placeholder="e.g. Stop wasting hours on social posts"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					onBlur={() => {
						if (title !== content.title) onUpdate({ title });
					}}
					className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
				/>
			</div>
			<div>
				<label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
					Description / Body Copy
				</label>
				<textarea
					placeholder="Caption, voiceover script, post body…"
					rows={3}
					value={body}
					onChange={(e) => setBody(e.target.value)}
					onBlur={() => {
						if (body !== content.body) onUpdate({ body });
					}}
					className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
				/>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-3">
				<div>
					<label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
						Media URL
					</label>
					<input
						type="url"
						placeholder="https://… (image, .mp4 video, or YouTube/Vimeo link)"
						value={mediaUrl}
						onChange={(e) => setMediaUrl(e.target.value)}
						onBlur={() => {
							// Sending just `media_url` lets the server auto-derive
							// `media_kind` from the URL; the user can still
							// override via the dropdown afterwards.
							if (mediaUrl !== content.media_url) onUpdate({ media_url: mediaUrl });
						}}
						className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
					/>
				</div>
				<div>
					<label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
						Type
					</label>
					<select
						value={content.media_kind}
						onChange={(e) => onUpdate({ media_kind: e.target.value as MediaKind })}
						className="w-full p-2 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
					>
						{ALLOWED_MEDIA_KINDS.map((k) => (
							<option key={k} value={k}>
								{k === "none" ? "no media" : k}
							</option>
						))}
					</select>
				</div>
			</div>
			{mediaUrl ? (
				<p className="text-[10px] text-slate-400">
					Auto-detected as <strong>{detectMediaKind(mediaUrl)}</strong> on save — override with the
					dropdown if wrong.
				</p>
			) : null}

			<div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-3">
				<div>
					<label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
						CTA Label
					</label>
					<input
						type="text"
						placeholder="Learn More"
						value={ctaLabel}
						onChange={(e) => setCtaLabel(e.target.value)}
						onBlur={() => {
							if (ctaLabel !== content.cta_label) onUpdate({ cta_label: ctaLabel });
						}}
						className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
					/>
				</div>
				<div>
					<label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
						CTA URL
					</label>
					<input
						type="url"
						placeholder="https://yourbrand.com/landing"
						value={ctaUrl}
						onChange={(e) => setCtaUrl(e.target.value)}
						onBlur={() => {
							if (ctaUrl !== content.cta_url) onUpdate({ cta_url: ctaUrl });
						}}
						className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
					/>
				</div>
			</div>
		</div>
	);
}

interface ContentRowProps {
	content: PromotionPlanContentRow;
	index: number;
	platformName: string;
	objective: string;
	dailyBudget: number;
	commentBucket: { post: PromotionPlanCommentRow[]; ad: PromotionPlanCommentRow[] };
	onUpdate: (patch: Partial<PromotionPlanContentRow>) => Promise<void>;
	onRemove: () => Promise<void>;
	submitComment: (kind: "post" | "ad", body: string) => Promise<void>;
}

function ContentRow(props: ContentRowProps) {
	const {
		content: c,
		index,
		platformName,
		objective,
		dailyBudget,
		commentBucket,
		onUpdate,
		onRemove,
		submitComment,
	} = props;

	const [postDraft, setPostDraft] = useState("");
	const [adDraft, setAdDraft] = useState("");
	const [adAmount, setAdAmount] = useState<number>(c.ad_budget_amount);
	useEffect(() => setAdAmount(c.ad_budget_amount), [c.ad_budget_amount]);

	const targetingFields: ReadonlyArray<{ key: keyof PromotionPlanContentRow["targeting"]; label: string; placeholder: string; type?: "select" }> = [
		{ key: "age", label: "Age Range", placeholder: "e.g. 18-35" },
		{ key: "gender", label: "Gender", placeholder: "All Genders", type: "select" },
		{ key: "location", label: "Location", placeholder: "e.g. Nationwide, New York" },
		{ key: "interests", label: "Interests", placeholder: "e.g. Technology, Fitness" },
	];

	return (
		<div className="p-6 flex flex-col xl:flex-row gap-8 items-start bg-slate-50/50">
			<div className="w-full xl:w-auto shrink-0 flex justify-center">
				<div className="relative group">
					<PlatformPreview platformName={platformName} objective={objective} content={c} />
					<div className="absolute top-2 left-2 bg-slate-800/80 backdrop-blur text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg z-30">
						Content Item #{index + 1}
					</div>
				</div>
			</div>

			<div className="flex-1 w-full space-y-6">
				<div className="flex justify-between items-center border-b border-slate-200 pb-3">
					<h3 className="font-bold text-slate-800">Content</h3>
					<button
						type="button"
						onClick={onRemove}
						className="text-slate-400 hover:text-red-500 transition-colors text-xs flex items-center gap-1"
					>
						<Trash2 className="w-3 h-3" /> Remove Item
					</button>
				</div>

				<ContentPayloadEditor content={c} onUpdate={onUpdate} />

				<h3 className="font-bold text-slate-800 border-b border-slate-200 pb-3">
					Distribution Strategy
				</h3>

				<div className="flex flex-wrap gap-4">
					<label
						className={`flex items-center gap-2 px-4 py-3 border rounded-xl transition-all cursor-pointer ${c.is_post ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}
					>
						<input
							type="checkbox"
							className="w-4 h-4 text-emerald-500 rounded focus:ring-emerald-500"
							checked={c.is_post}
							onChange={(e) => onUpdate({ is_post: e.target.checked })}
						/>
						<span className="font-semibold text-sm">Organic Post</span>
					</label>
					<label
						className={`flex items-center gap-2 px-4 py-3 border rounded-xl transition-all cursor-pointer ${c.is_ad ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600"}`}
					>
						<input
							type="checkbox"
							className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500"
							checked={c.is_ad}
							onChange={(e) => onUpdate({ is_ad: e.target.checked })}
						/>
						<span className="font-semibold text-sm">Paid Ad Promotion</span>
					</label>
				</div>

				{!c.is_post && !c.is_ad ? (
					<p className="text-amber-600 text-sm font-medium bg-amber-50 p-3 rounded-lg border border-amber-200">
						Please select at least one distribution method (Post or Ad) for this content piece.
					</p>
				) : null}

				{c.is_ad ? (
					<div className="bg-white border border-blue-200 rounded-xl p-5 shadow-sm space-y-5">
						<h4 className="font-bold text-slate-800 flex items-center gap-2">
							<TrendingUp className="w-4 h-4 text-blue-500" /> Ad Configuration
						</h4>
						<div className="bg-amber-50 text-amber-800 text-xs p-3 rounded-lg border border-amber-200">
							<strong>Compliance Note:</strong> Restricting targeting by age, location, or gender
							may be restricted or illegal in certain industries (e.g. Housing, Employment,
							Credit). Please ensure your selections comply with platform policies.
						</div>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<label className="block text-xs font-semibold text-slate-600 uppercase">
									Daily Allocation
								</label>
								<div className="flex gap-4 mb-2">
									<label className="flex items-center gap-2 text-sm cursor-pointer">
										<input
											type="radio"
											name={`budgetMode-${c.id}`}
											checked={c.ad_budget_mode === "dynamic"}
											onChange={() => onUpdate({ ad_budget_mode: "dynamic" })}
											className="text-blue-500 focus:ring-blue-500"
										/>
										Dynamic (Default)
									</label>
									<label className="flex items-center gap-2 text-sm cursor-pointer">
										<input
											type="radio"
											name={`budgetMode-${c.id}`}
											checked={c.ad_budget_mode === "fixed"}
											onChange={() => onUpdate({ ad_budget_mode: "fixed" })}
											className="text-blue-500 focus:ring-blue-500"
										/>
										Fixed Amount
									</label>
								</div>
								{c.ad_budget_mode === "fixed" ? (
									<div className="flex items-center gap-2 mt-2">
										<span className="text-slate-500">$</span>
										<input
											type="number"
											className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
											value={adAmount}
											onChange={(e) => setAdAmount(Number(e.target.value) || 0)}
											onBlur={() => {
												const clamped = dailyBudget > 0 ? Math.min(adAmount, dailyBudget) : adAmount;
												if (clamped !== c.ad_budget_amount) {
													onUpdate({ ad_budget_amount: clamped });
												}
											}}
											max={dailyBudget}
										/>
										<span className="text-xs text-slate-400 whitespace-nowrap">
											/ day (Max: ${dailyBudget})
										</span>
									</div>
								) : null}
							</div>
							<div className="space-y-3">
								{targetingFields.map((field) => (
									<div key={field.key}>
										<label className="block text-[10px] font-bold text-slate-500 uppercase">
											{field.label}
										</label>
										{field.type === "select" ? (
											<select
												value={c.targeting?.[field.key] ?? "All"}
												onChange={(e) =>
													onUpdate({ targeting: { ...c.targeting, [field.key]: e.target.value } })
												}
												className="w-full p-1.5 text-sm border-b border-slate-300 bg-transparent outline-none focus:border-blue-500"
											>
												<option value="All">All Genders</option>
												<option value="Men">Men</option>
												<option value="Women">Women</option>
											</select>
										) : (
											<input
												type="text"
												placeholder={field.placeholder}
												value={c.targeting?.[field.key] ?? ""}
												onChange={(e) =>
													onUpdate({ targeting: { ...c.targeting, [field.key]: e.target.value } })
												}
												className="w-full p-1.5 text-sm border-b border-slate-300 bg-transparent outline-none focus:border-blue-500"
											/>
										)}
									</div>
								))}
							</div>
						</div>
					</div>
				) : null}

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200">
					{c.is_post ? (
						<ReviewBlock
							title="Organic Post Review"
							accent="emerald"
							status={c.post_status}
							onSetStatus={(s) =>
								onUpdate({ post_status: s as PromotionPlanContentRow["post_status"] })
							}
							comments={commentBucket.post}
							draft={postDraft}
							setDraft={setPostDraft}
							onSubmit={async () => {
								await submitComment("post", postDraft);
								setPostDraft("");
							}}
						/>
					) : null}
					{c.is_ad ? (
						<ReviewBlock
							title="Paid Ad Review"
							accent="blue"
							status={c.ad_status}
							onSetStatus={(s) =>
								onUpdate({ ad_status: s as PromotionPlanContentRow["ad_status"] })
							}
							comments={commentBucket.ad}
							draft={adDraft}
							setDraft={setAdDraft}
							onSubmit={async () => {
								await submitComment("ad", adDraft);
								setAdDraft("");
							}}
						/>
					) : null}
				</div>
			</div>
		</div>
	);
}

interface ReviewBlockProps {
	title: string;
	accent: "emerald" | "blue";
	status: "pending" | "approved" | "rejected";
	onSetStatus: (s: "approved" | "rejected") => void;
	comments: PromotionPlanCommentRow[];
	draft: string;
	setDraft: (v: string) => void;
	onSubmit: () => Promise<void>;
}

function ReviewBlock(props: ReviewBlockProps) {
	const { title, accent, status, onSetStatus, comments, draft, setDraft, onSubmit } = props;
	const accentBtn = accent === "emerald" ? "bg-emerald-500 border-emerald-500" : "bg-blue-500 border-blue-500";
	const accentHover = accent === "emerald" ? "hover:bg-emerald-50" : "hover:bg-blue-50";
	const statusClass =
		status === "approved"
			? accent === "emerald"
				? "bg-emerald-100 text-emerald-700"
				: "bg-blue-100 text-blue-700"
			: status === "rejected"
				? "bg-red-100 text-red-700"
				: "bg-slate-200 text-slate-600";
	return (
		<div className="space-y-3">
			<div className="space-y-2">
				<p className="text-sm font-semibold text-slate-600 flex items-center justify-between">
					{title}
					<span
						className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold ${statusClass}`}
					>
						{status}
					</span>
				</p>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => onSetStatus("approved")}
						className={`flex-1 flex items-center justify-center gap-1.5 p-2 rounded-lg text-sm font-bold transition-all border ${
							status === "approved" ? `${accentBtn} text-white shadow-sm` : `bg-white text-slate-600 ${accentHover} border-slate-200`
						}`}
					>
						<ThumbsUp className="w-4 h-4" /> Approve
					</button>
					<button
						type="button"
						onClick={() => onSetStatus("rejected")}
						className={`flex-1 flex items-center justify-center gap-1.5 p-2 rounded-lg text-sm font-bold transition-all border ${
							status === "rejected"
								? "bg-red-500 text-white border-red-500 shadow-sm"
								: "bg-white text-slate-600 hover:bg-red-50 border-slate-200"
						}`}
					>
						<ThumbsDown className="w-4 h-4" /> Reject
					</button>
				</div>
			</div>

			<div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
				{comments.length > 0 ? (
					<div className="space-y-2 mb-3 max-h-40 overflow-y-auto pr-1">
						{comments.map((cm) => (
							<div key={cm.id} className="bg-white p-2.5 rounded-lg border border-slate-100 shadow-sm">
								<p className={`text-[10px] font-bold mb-0.5 ${accent === "emerald" ? "text-emerald-600" : "text-blue-600"}`}>
									{cm.author_name} · {new Date(cm.created_at).toLocaleString()}
								</p>
								<p className="text-xs text-slate-700 whitespace-pre-wrap">{cm.body}</p>
							</div>
						))}
					</div>
				) : null}
				<div className="flex flex-col gap-2">
					<textarea
						className="w-full p-2 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 outline-none resize-none bg-white"
						rows={2}
						placeholder={`Add feedback for ${accent === "emerald" ? "organic post" : "paid ad"}…`}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
					/>
					<button
						type="button"
						onClick={onSubmit}
						className={`self-end inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${accent === "emerald" ? "bg-emerald-100 hover:bg-emerald-200 text-emerald-800" : "bg-blue-100 hover:bg-blue-200 text-blue-800"}`}
					>
						<Send className="w-3 h-3" /> Submit Note
					</button>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Mock platform preview
// ---------------------------------------------------------------------------

interface PlatformPreviewProps {
	platformName: string;
	objective: string;
	content: PromotionPlanContentRow;
}

function PlatformPreview({ platformName, objective, content }: PlatformPreviewProps) {
	const platInfo = PLATFORMS.find((p) => p.name === platformName);
	if (!platInfo) return null;
	const Icon = platInfo.icon;

	const titleFallback = content.title || `Stop wasting hours on ${platformName}`;
	const bodyFallback =
		content.body ||
		`Struggling to manage your ${platformName} presence? Our automation drives ${objective.toLowerCase()} efficiently.`;
	const ctaLabel = content.cta_label || "Learn More";

	if (platInfo.type === "vertical") {
		return (
			<div className="w-[280px] bg-slate-900 rounded-[2.5rem] p-2 shadow-xl border-[6px] border-slate-800 relative overflow-hidden h-[500px] flex flex-col mx-auto shrink-0">
				<div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-800 rounded-b-2xl z-20" />
				<div className="relative flex-grow bg-slate-800 rounded-[2rem] overflow-hidden">
					<MediaSurface content={content} aspect="vertical" />
					<div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent z-10 pointer-events-none" />
					<div className="absolute top-8 left-4 z-20 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full flex items-center gap-2">
						<Icon className="w-4 h-4 text-white" />
						<span className="text-xs font-semibold text-white">{platformName}</span>
					</div>
					<div className="absolute bottom-4 left-4 right-16 z-20 space-y-2">
						<div className="flex items-center gap-2">
							<div className="w-8 h-8 rounded-full bg-emerald-500 border-2 border-white" />
							<span className="text-sm font-bold text-white">@yourbrand</span>
						</div>
						<p className="text-sm font-bold text-white line-clamp-2">{titleFallback}</p>
						<p className="text-xs text-slate-200 line-clamp-3">{bodyFallback}</p>
						{content.cta_url ? (
							<a
								href={content.cta_url}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-block mt-1 bg-white text-slate-900 text-[10px] font-bold px-2 py-1 rounded-full"
							>
								{ctaLabel}
							</a>
						) : null}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="w-[320px] bg-white rounded-2xl p-4 shadow-lg border border-slate-200 shrink-0 mx-auto">
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold">
						YB
					</div>
					<div>
						<p className="text-sm font-bold text-slate-800 leading-tight">Your Brand</p>
						<p className="text-[10px] text-slate-500">Sponsored · 2h</p>
					</div>
				</div>
				<Icon className="w-5 h-5 text-slate-300" />
			</div>
			<p className="text-sm font-bold text-slate-900 mb-1 leading-tight">{titleFallback}</p>
			<p className="text-sm text-slate-700 mb-3 leading-relaxed line-clamp-3">{bodyFallback}</p>
			<div className="w-full h-40 bg-slate-100 rounded-lg overflow-hidden mb-3 relative">
				<MediaSurface content={content} aspect="feed" />
				{content.cta_url ? (
					<a
						href={content.cta_url}
						target="_blank"
						rel="noopener noreferrer"
						className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 px-2 py-1 rounded text-[10px] text-white font-semibold"
					>
						{ctaLabel}
					</a>
				) : (
					<div className="absolute bottom-2 right-2 bg-black/60 px-2 py-1 rounded text-[10px] text-white font-semibold">
						{ctaLabel}
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * Renders the media payload for a content piece inside an existing
 * preview container (the parent supplies width / height / positioning).
 * Falls back to a tasteful Unsplash placeholder when no media URL is
 * set so the preview still looks like a real post.
 */
function MediaSurface({
	content,
	aspect,
}: {
	content: PromotionPlanContentRow;
	aspect: "vertical" | "feed";
}) {
	const placeholder =
		aspect === "vertical"
			? "https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400&q=80"
			: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&q=80";
	const opacity = aspect === "vertical" ? "opacity-60" : "";

	if (!content.media_url) {
		return (
			<img
				src={placeholder}
				alt="Preview placeholder"
				className={`absolute inset-0 w-full h-full object-cover ${opacity}`}
			/>
		);
	}

	if (content.media_kind === "video") {
		return (
			<video
				src={content.media_url}
				controls
				playsInline
				preload="metadata"
				className={`absolute inset-0 w-full h-full object-cover bg-black ${opacity}`}
			>
				<track kind="captions" />
			</video>
		);
	}

	if (content.media_kind === "embed") {
		return (
			<iframe
				src={toEmbedSrc(content.media_url)}
				title="Media preview"
				allow="autoplay; encrypted-media; picture-in-picture"
				allowFullScreen
				className="absolute inset-0 w-full h-full"
			/>
		);
	}

	// 'image' or 'none' (with a URL) — render as image.
	return (
		<img
			src={content.media_url}
			alt={content.title || "Content preview"}
			className={`absolute inset-0 w-full h-full object-cover ${opacity}`}
		/>
	);
}

// NOTE: The Fabric.js + ShotStack visual workspace was removed for now.
// The `shotstack_template_id` column on `promotion_plans` and the
// `/api/plan/templates` endpoint are intentionally kept so the canvas
// can be re-introduced later without a data migration. The original
// `CanvasSection` / `TemplatePicker` / `drawTemplate` block lives in
// git history if you need to revive it.
