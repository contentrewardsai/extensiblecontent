"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

const PLAN_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

function slugify(raw: string): string {
	return raw
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export function PlanIndexClient({ brand }: { brand: string }) {
	const router = useRouter();
	const [raw, setRaw] = useState("");
	const [error, setError] = useState<string | null>(null);

	const slug = slugify(raw);
	const isValid = PLAN_ID_RE.test(slug);

	const handleSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			if (!slug) {
				setError("Enter a name for your plan.");
				return;
			}
			if (!isValid) {
				setError(
					"Slug must be 3–64 characters, lowercase letters, numbers, and hyphens only (must start with a letter or number).",
				);
				return;
			}
			setError(null);
			router.push(`/plan/${slug}`);
		},
		[slug, isValid, router],
	);

	return (
		<div
			data-plan-root
			className="min-h-screen bg-slate-50 flex items-center justify-center p-8"
		>
			<div className="max-w-lg w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
				<h1 className="text-2xl font-bold text-slate-800 mb-2 text-center">
					{brand}
				</h1>
				<p className="text-sm text-slate-500 mb-8 text-center">
					Create or open a promotion plan. Choose a short, memorable
					slug — it becomes part of the shareable URL.
				</p>

				<form onSubmit={handleSubmit}>
					<label
						htmlFor="plan-slug"
						className="block text-sm font-semibold text-slate-700 mb-2"
					>
						Plan slug
					</label>

					<div className="flex items-stretch gap-0 rounded-lg border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-emerald-400 focus-within:border-emerald-400 transition-shadow mb-1">
						<span className="flex items-center bg-slate-100 text-slate-500 text-sm px-3 select-none border-r border-slate-300 whitespace-nowrap">
							/plan/
						</span>
						<input
							id="plan-slug"
							type="text"
							value={raw}
							onChange={(e) => {
								setRaw(e.target.value);
								setError(null);
							}}
							placeholder="summer-campaign"
							autoFocus
							autoComplete="off"
							spellCheck={false}
							className="flex-1 min-w-0 px-3 py-3 text-sm text-slate-800 bg-white outline-none"
						/>
					</div>

					{raw && slug && slug !== raw.toLowerCase().trim() && (
						<p className="text-xs text-slate-400 mb-2">
							Will be saved as:{" "}
							<span className="font-mono text-slate-600">
								{slug}
							</span>
						</p>
					)}

					{error && (
						<p className="text-xs text-red-500 mb-2">{error}</p>
					)}

					<button
						type="submit"
						disabled={!slug}
						className="mt-4 w-full rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-3 text-sm font-semibold transition-colors"
					>
						Go to plan
					</button>
				</form>
			</div>
		</div>
	);
}
