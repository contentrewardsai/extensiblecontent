"use client";

import { useActionState } from "react";
import { queueShotstackRenderAction, type ShotstackRenderActionState } from "../../experience-actions";

type TemplateOpt = { id: string; name: string; isBuiltin?: boolean | null };

export function ShotstackRenderForm({
	experienceId,
	templates,
}: {
	experienceId: string;
	templates: TemplateOpt[];
}) {
	const [state, formAction, pending] = useActionState(queueShotstackRenderAction, null);

	return (
		<div className="border border-gray-a4 rounded-lg p-4 bg-gray-a2 space-y-3">
			<h3 className="text-5 font-semibold text-gray-12">Queue render</h3>
			<p className="text-3 text-gray-10">
				<strong>Staging</strong> uses the ShotStack sandbox (no credits). <strong>Production</strong> uses your managed
				credits unless you enable BYOK.
			</p>
			<form action={formAction} className="flex flex-col gap-3 max-w-xl">
				<input type="hidden" name="experienceId" value={experienceId} />
				<label className="text-3 text-gray-11 flex flex-col gap-1">
					Template (optional)
					<select
						name="template_id"
						className="border border-gray-a4 rounded-md px-3 py-2 text-gray-12 bg-gray-a1"
						defaultValue=""
					>
						<option value="">— Paste JSON below instead —</option>
						{templates.map((t) => (
							<option key={t.id} value={t.id}>
								{t.isBuiltin ? `[Starter] ${t.name}` : t.name}
							</option>
						))}
					</select>
				</label>
				<label className="text-3 text-gray-11 flex flex-col gap-1">
					Edit JSON (if no template selected)
					<textarea
						name="edit"
						rows={8}
						className="border border-gray-a4 rounded-md px-3 py-2 font-mono text-2 text-gray-12 bg-gray-a1"
						placeholder='{"timeline": ...}'
					/>
				</label>
				<label className="text-3 text-gray-11 flex flex-col gap-1">
					Duration (seconds)
					<input
						name="duration_seconds"
						type="number"
						step="any"
						min="0.1"
						required
						defaultValue="10"
						className="border border-gray-a4 rounded-md px-3 py-2 text-gray-12 bg-gray-a1"
					/>
				</label>
				<label className="text-3 text-gray-11 flex flex-col gap-1">
					Environment
					<select name="env" className="border border-gray-a4 rounded-md px-3 py-2 text-gray-12 bg-gray-a1">
						<option value="stage">Staging (sandbox)</option>
						<option value="v1">Production (v1)</option>
					</select>
				</label>
				<label className="text-3 text-gray-11 flex items-center gap-2">
					<input type="checkbox" name="use_own_key" className="rounded" />
					Use my ShotStack API key (BYOK)
				</label>
				<button
					type="submit"
					disabled={pending}
					className="self-start text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 disabled:opacity-50"
				>
					{pending ? "Submitting…" : "Queue render"}
				</button>
			</form>
			{state && !state.ok ? <p className="text-3 text-red-11">{state.error}</p> : null}
			{state && state.ok ? (
				<div className="text-3 text-gray-11 space-y-1 border border-gray-a4 rounded-md p-3 bg-gray-a1">
					<p>
						<strong className="text-gray-12">Render id:</strong> {state.id}
					</p>
					<p>
						<strong className="text-gray-12">Status:</strong> {state.status}
					</p>
					{state.url ? (
						<p>
							<strong className="text-gray-12">URL:</strong>{" "}
							<a href={state.url} className="underline text-gray-12" target="_blank" rel="noreferrer">
								{state.url}
							</a>
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
