import { requireExperienceContext } from "@/lib/experience-context";
import { getServiceSupabase } from "@/lib/supabase-service";
import { createGeneratorTemplate, deleteGeneratorTemplate } from "../experience-actions";

const ERR: Record<string, string> = {
	bad_json: "Payload must be valid JSON object.",
	missing_name: "Name is required.",
	save_failed: "Could not save template.",
};

export default async function TemplatesPage({
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
	const { data: rows, error } = await supabase
		.from("generator_templates")
		.select("id, name, payload, created_at, updated_at")
		.eq("user_id", internalUserId)
		.order("updated_at", { ascending: false });

	if (error) {
		return <p className="text-3 text-red-11">Could not load templates.</p>;
	}

	return (
		<div className="flex flex-col gap-8">
			<div>
				<h2 className="text-6 font-bold text-gray-12">Generator templates</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					Cloud-synced Content Generator templates. The Chrome extension can POST/GET the same data via{" "}
					<code className="text-2 bg-gray-a3 px-1 rounded">/api/extension/generator-templates</code>.
				</p>
			</div>

			{err && ERR[err] ? (
				<p className="text-3 text-red-11 border border-red-a6 rounded-lg p-3 bg-red-a2">{ERR[err]}</p>
			) : null}

			<section className="border border-gray-a4 rounded-lg p-4 bg-gray-a2 space-y-3">
				<h3 className="text-5 font-semibold text-gray-12">Add template</h3>
				<form action={createGeneratorTemplate} className="flex flex-col gap-3 max-w-xl">
					<input type="hidden" name="experienceId" value={experienceId} />
					<label className="text-3 text-gray-11 flex flex-col gap-1">
						Name
						<input
							name="name"
							required
							className="border border-gray-a4 rounded-md px-3 py-2 text-gray-12 bg-gray-a1"
							placeholder="My template"
						/>
					</label>
					<label className="text-3 text-gray-11 flex flex-col gap-1">
						Payload (JSON object, optional)
						<textarea
							name="payload"
							rows={6}
							className="border border-gray-a4 rounded-md px-3 py-2 font-mono text-2 text-gray-12 bg-gray-a1"
							placeholder="{}"
						/>
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
				<h3 className="text-5 font-semibold text-gray-12 mb-3">Your templates</h3>
				{(rows ?? []).length === 0 ? (
					<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-6 bg-gray-a2">No templates yet.</p>
				) : (
					<ul className="flex flex-col gap-3">
						{(rows ?? []).map((row) => (
							<li key={row.id} className="border border-gray-a4 rounded-lg p-4 bg-gray-a2">
								<div className="flex flex-wrap items-start justify-between gap-2">
									<div>
										<p className="text-5 font-medium text-gray-12">{row.name}</p>
										<p className="text-2 text-gray-10 mt-1">
											Updated {row.updated_at ? new Date(row.updated_at).toLocaleString() : "—"}
										</p>
									</div>
									<form action={deleteGeneratorTemplate}>
										<input type="hidden" name="experienceId" value={experienceId} />
										<input type="hidden" name="templateId" value={row.id} />
										<button
											type="submit"
											className="text-3 text-red-11 underline hover:no-underline"
											aria-label={`Delete ${row.name}`}
										>
											Delete
										</button>
									</form>
								</div>
								<pre className="text-2 font-mono text-gray-11 mt-3 max-h-40 overflow-auto border border-gray-a4 rounded p-2 bg-gray-a1">
									{JSON.stringify(row.payload, null, 2)}
								</pre>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
