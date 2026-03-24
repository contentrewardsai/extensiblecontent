import { requireExperienceContext } from "@/lib/experience-context";
import { listUserWorkflowUploads } from "@/lib/storage-workflow-uploads";
import { getServiceSupabase } from "@/lib/supabase-service";

function publicWorkflowDataUrl(objectPath: string): string {
	const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
	return `${base}/storage/v1/object/public/workflow-data/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

export default async function UploadsPage({ params }: { params: Promise<{ experienceId: string }> }) {
	const { experienceId } = await params;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	const objects = await listUserWorkflowUploads(supabase, internalUserId);

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h2 className="text-6 font-bold text-gray-12">Workflow uploads</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					Files uploaded via the extension into Supabase Storage (workflow step media). Up to 400 objects listed;
					deeper folders are scanned automatically.
				</p>
			</div>

			{objects.length === 0 ? (
				<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-6 bg-gray-a2">
					No uploaded files yet. Record or attach media in a workflow from the extension.
				</p>
			) : (
				<div className="overflow-x-auto border border-gray-a4 rounded-lg max-h-[480px] overflow-y-auto">
					<table className="w-full text-left text-3">
						<thead className="bg-gray-a3 border-b border-gray-a4 sticky top-0">
							<tr>
								<th className="p-3 font-semibold text-gray-12">File</th>
								<th className="p-3 font-semibold text-gray-12">Updated</th>
								<th className="p-3 font-semibold text-gray-12">Open</th>
							</tr>
						</thead>
						<tbody>
							{objects.map((o) => (
								<tr key={o.path} className="border-b border-gray-a4 last:border-0">
									<td className="p-3 text-gray-11 font-mono text-2 break-all">{o.path}</td>
									<td className="p-3 text-gray-10 whitespace-nowrap">
										{o.updated_at ? new Date(o.updated_at).toLocaleString() : "—"}
									</td>
									<td className="p-3">
										<a
											href={publicWorkflowDataUrl(o.path)}
											target="_blank"
											rel="noopener noreferrer"
											className="text-gray-12 underline"
										>
											View
										</a>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
