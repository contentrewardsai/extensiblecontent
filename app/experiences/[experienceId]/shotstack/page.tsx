import Link from "next/link";
import { requireExperienceContext } from "@/lib/experience-context";
import { getSpendableCredits } from "@/lib/shotstack-ledger";
import { getServiceSupabase } from "@/lib/supabase-service";
import {
	cloneShotstackTemplate,
	createShotstackTemplate,
	deleteShotstackTemplate,
	updateShotstackTemplate,
} from "../experience-actions";
import { BrowserRenderButton } from "./browser-render-button";
import type { ShotstackEditorContext } from "./shotstack-editor-context";
import { ShotstackRenderForm } from "./shotstack-render-form";

const ERR: Record<string, string> = {
	bad_json: "Edit must be valid JSON object.",
	missing_fields: "Name and edit JSON are required.",
	save_failed: "Could not save template.",
	not_found: "Template not found.",
	builtin_readonly: "Built-in templates are read-only. Clone to edit, or use the visual editor on your own copy.",
	builtin_editor: "Open a template you own. Use “Clone to edit” for starter templates.",
};

export default async function ShotstackPage({
	params,
	searchParams,
}: {
	params: Promise<{ experienceId: string }>;
	searchParams: Promise<{ err?: string }>;
}) {
	const { experienceId } = await params;
	const { err } = await searchParams;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	const [templatesRes, rendersRes, userRes, spendableCredits] = await Promise.all([
		supabase
			.from("shotstack_templates")
			.select("id, name, edit, default_env, is_builtin, source_path, created_at, updated_at")
			.or(`user_id.eq.${internalUserId},is_builtin.eq.true`)
			.order("is_builtin", { ascending: true })
			.order("updated_at", { ascending: false }),
		supabase
			.from("shotstack_renders")
			.select("id, shotstack_render_id, status, output_url, credits_used, env, created_at")
			.eq("user_id", internalUserId)
			.order("created_at", { ascending: false })
			.limit(50),
		supabase.from("users").select("shotstack_api_key_encrypted").eq("id", internalUserId).single(),
		getSpendableCredits(supabase, internalUserId),
	]);

	const templates = templatesRes.data ?? [];
	const editorContext: ShotstackEditorContext = {
		templatesApiBase: "/api/whop/shotstack-templates",
		templatesApiQuery: `experienceId=${encodeURIComponent(experienceId)}`,
		browserRenderUrl: "/api/whop/shotstack/browser-render",
		browserRenderFields: { experienceId },
		editorUrlPrefix: `/experiences/${experienceId}/shotstack/editor`,
		backUrl: `/experiences/${experienceId}/shotstack`,
	};
	const renders = rendersRes.data ?? [];
	// Always read the spendable balance from the ledger (unexpired grants
	// minus debits) instead of the cached column so this page can never lag
	// behind a webhook that just expired or topped up credits.
	const credits = spendableCredits;
	const hasByok = !!userRes.data?.shotstack_api_key_encrypted?.trim();

	return (
		<div className="flex flex-col gap-8">
			<div>
				<h2 className="text-6 font-bold text-gray-12">ShotStack</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					Templates and renders sync with the extension APIs{" "}
					<code className="text-2 bg-gray-a3 px-1 rounded">/api/extension/shotstack-templates</code> and{" "}
					<code className="text-2 bg-gray-a3 px-1 rounded">/api/extension/shotstack/render</code>.
				</p>
			</div>

			<div className="flex flex-wrap gap-4 text-3 text-gray-11 border border-gray-a4 rounded-lg p-4 bg-gray-a2 items-center">
				<span>
					<strong className="text-gray-12">Credits:</strong> {credits.toFixed(2)}
				</span>
				<span>
					<strong className="text-gray-12">BYOK:</strong> {hasByok ? "configured" : "not set"}
				</span>
				<Link
					href={`/experiences/${experienceId}/shotstack/billing`}
					className="ml-auto text-3 text-gray-12 underline hover:no-underline"
				>
					View billing history →
				</Link>
			</div>

			{err && ERR[err] ? (
				<p className="text-3 text-red-11 border border-red-a6 rounded-lg p-3 bg-red-a2">{ERR[err]}</p>
			) : null}

			<ShotstackRenderForm
				experienceId={experienceId}
				templates={templates.map((t) => ({ id: t.id, name: t.name, isBuiltin: t.is_builtin }))}
			/>

			<section className="border border-gray-a4 rounded-lg p-4 bg-gray-a2 space-y-3">
				<h3 className="text-5 font-semibold text-gray-12">Save ShotStack template</h3>
				<form action={createShotstackTemplate} className="flex flex-col gap-3 max-w-xl">
					<input type="hidden" name="experienceId" value={experienceId} />
					<label className="text-3 text-gray-11 flex flex-col gap-1">
						Name
						<input
							name="name"
							required
							className="border border-gray-a4 rounded-md px-3 py-2 text-gray-12 bg-gray-a1"
							placeholder="Holiday promo"
						/>
					</label>
					<label className="text-3 text-gray-11 flex flex-col gap-1">
						Edit JSON
						<textarea
							name="edit"
							required
							rows={8}
							className="border border-gray-a4 rounded-md px-3 py-2 font-mono text-2 text-gray-12 bg-gray-a1"
						/>
					</label>
					<label className="text-3 text-gray-11 flex flex-col gap-1">
						Default environment
						<select name="default_env" className="border border-gray-a4 rounded-md px-3 py-2 text-gray-12 bg-gray-a1">
							<option value="v1">Production (v1)</option>
							<option value="stage">Staging</option>
						</select>
					</label>
					<button
						type="submit"
						className="self-start text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90"
					>
						Save template
					</button>
				</form>
			</section>

			<section>
				<h3 className="text-5 font-semibold text-gray-12 mb-3">Saved templates</h3>
				{templates.length === 0 ? (
					<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-6 bg-gray-a2">No templates yet.</p>
				) : (
					<ul className="flex flex-col gap-3">
						{templates.map((row) => (
							<li key={row.id} className="border border-gray-a4 rounded-lg p-4 bg-gray-a2">
								<div className="flex flex-wrap items-start justify-between gap-2">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<p className="text-5 font-medium text-gray-12">{row.name}</p>
											{row.is_builtin ? (
												<span className="text-2 px-2 py-0.5 rounded bg-gray-a4 text-gray-11">Starter</span>
											) : null}
										</div>
										<p className="text-2 text-gray-10 mt-1">
											Default env: {row.default_env} · Updated{" "}
											{row.updated_at ? new Date(row.updated_at).toLocaleString() : "—"}
											{row.source_path ? (
												<>
													{" "}
													· <code className="text-2 bg-gray-a3 px-1 rounded">{row.source_path}</code>
												</>
											) : null}
										</p>
										{row.is_builtin ? (
											<p className="text-2 text-gray-10 mt-2 max-w-2xl">
												Read-only. Clone to get your own editable copy, or open it in the visual editor after
												cloning.
											</p>
										) : null}
									</div>
									<div className="flex flex-wrap items-center gap-3 shrink-0">
										<BrowserRenderButton
											templateId={row.id}
											templateName={row.name}
											context={editorContext}
										/>
										{row.is_builtin ? (
											<form action={cloneShotstackTemplate} className="inline">
												<input type="hidden" name="experienceId" value={experienceId} />
												<input type="hidden" name="templateId" value={row.id} />
												<button
													type="submit"
													className="text-3 text-gray-12 px-3 py-1.5 rounded-md border border-gray-a4 bg-gray-a1 hover:opacity-90"
												>
													Clone to edit
												</button>
											</form>
										) : (
											<>
												<Link
													href={`/experiences/${experienceId}/shotstack/editor/${row.id}`}
													className="text-3 text-gray-12 px-3 py-1.5 rounded-md border border-gray-a4 bg-gray-a1 hover:opacity-90"
												>
													Edit (visual)
												</Link>
												<form action={deleteShotstackTemplate} className="inline">
													<input type="hidden" name="experienceId" value={experienceId} />
													<input type="hidden" name="templateId" value={row.id} />
													<button type="submit" className="text-3 text-red-11 underline hover:no-underline">
														Delete
													</button>
												</form>
											</>
										)}
									</div>
								</div>
								{!row.is_builtin && row.edit && typeof row.edit === "object" ? (
									<details className="mt-3 border border-gray-a4 rounded-md p-3 bg-gray-a1">
										<summary className="text-3 text-gray-11 cursor-pointer">Edit JSON</summary>
										<form action={updateShotstackTemplate} className="mt-3 flex flex-col gap-2">
											<input type="hidden" name="experienceId" value={experienceId} />
											<input type="hidden" name="templateId" value={row.id} />
											<label className="text-3 text-gray-11 flex flex-col gap-1">
												Name
												<input
													name="name"
													defaultValue={row.name}
													className="border border-gray-a4 rounded-md px-3 py-2 text-gray-12 bg-gray-a2"
												/>
											</label>
											<label className="text-3 text-gray-11 flex flex-col gap-1">
												Edit JSON
												<textarea
													name="edit"
													required
													rows={10}
													defaultValue={JSON.stringify(row.edit, null, 2)}
													className="border border-gray-a4 rounded-md px-3 py-2 font-mono text-2 text-gray-12 bg-gray-a2"
												/>
											</label>
											<label className="text-3 text-gray-11 flex flex-col gap-1">
												Default environment
												<select
													name="default_env"
													defaultValue={row.default_env === "stage" ? "stage" : "v1"}
													className="border border-gray-a4 rounded-md px-3 py-2 text-gray-12 bg-gray-a2"
												>
													<option value="v1">Production (v1)</option>
													<option value="stage">Staging</option>
												</select>
											</label>
											<button
												type="submit"
												className="self-start text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90"
											>
												Save changes
											</button>
										</form>
									</details>
								) : null}
							</li>
						))}
					</ul>
				)}
			</section>

			<section>
				<h3 className="text-5 font-semibold text-gray-12 mb-3">Recent renders</h3>
				{renders.length === 0 ? (
					<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-6 bg-gray-a2">No renders yet.</p>
				) : (
					<div className="overflow-x-auto border border-gray-a4 rounded-lg">
						<table className="w-full text-left text-3">
							<thead className="bg-gray-a3 border-b border-gray-a4">
								<tr>
									<th className="p-3 font-semibold text-gray-12">Created</th>
									<th className="p-3 font-semibold text-gray-12">Env</th>
									<th className="p-3 font-semibold text-gray-12">Status</th>
									<th className="p-3 font-semibold text-gray-12">Credits</th>
									<th className="p-3 font-semibold text-gray-12">Output</th>
								</tr>
							</thead>
							<tbody>
								{renders.map((r) => (
									<tr key={r.id} className="border-b border-gray-a4 last:border-0">
										<td className="p-3 text-gray-11 whitespace-nowrap">
											{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
										</td>
										<td className="p-3 text-gray-11">{r.env}</td>
										<td className="p-3 text-gray-11">{r.status}</td>
										<td className="p-3 text-gray-11">{r.credits_used}</td>
										<td className="p-3">
											{r.output_url ? (
												<a href={r.output_url} className="underline text-gray-12" target="_blank" rel="noreferrer">
													Open
												</a>
											) : (
												<span className="text-gray-10">—</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
}
