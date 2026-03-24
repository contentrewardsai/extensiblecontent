import { requireExperienceContext } from "@/lib/experience-context";
import { getServiceSupabase } from "@/lib/supabase-service";
import { CloudUploadForm, ConnectUrlForm } from "./upload-post-client";

export default async function UploadPostPage({ params }: { params: Promise<{ experienceId: string }> }) {
	const { experienceId } = await params;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	const { data: accounts, error } = await supabase
		.from("upload_post_accounts")
		.select("id, name, upload_post_username, uses_own_key, created_at, updated_at, jwt_access_url, jwt_expires_at")
		.eq("user_id", internalUserId)
		.order("created_at", { ascending: false });

	if (error) {
		return <p className="text-3 text-red-11">Could not load Upload-Post accounts.</p>;
	}

	const list = accounts ?? [];

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h2 className="text-6 font-bold text-gray-12">Upload Post</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					Connected profiles for posting to social platforms via{" "}
					<a href="https://upload-post.com" className="underline text-gray-12" target="_blank" rel="noreferrer">
						Upload-Post
					</a>
					. Managed-key accounts can use the cloud proxy from this page; BYOK accounts must post with your own API key
					from the extension.
				</p>
			</div>

			{list.length === 0 ? (
				<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-6 bg-gray-a2">
					No accounts yet. Create one from the extension (Connected profiles) or POST{" "}
					<code className="text-2 bg-gray-a3 px-1 rounded">/api/extension/upload-post-accounts</code>.
				</p>
			) : (
				<ul className="flex flex-col gap-6">
					{list.map((acc) => (
						<li key={acc.id} className="border border-gray-a4 rounded-lg p-4 bg-gray-a2">
							<div className="flex flex-wrap items-baseline justify-between gap-2">
								<div>
									<p className="text-5 font-semibold text-gray-12">{acc.name}</p>
									<p className="text-2 text-gray-10 font-mono mt-1">{acc.upload_post_username}</p>
									<p className="text-2 text-gray-10 mt-1">
										{acc.uses_own_key ? "BYOK — use extension for API calls" : "Managed key — cloud proxy available"}
									</p>
								</div>
							</div>

							<div className="mt-3 border-t border-gray-a4 pt-3">
								<p className="text-3 font-medium text-gray-12">Connect social accounts</p>
								<p className="text-2 text-gray-10 mt-1">
									Opens Upload-Post&apos;s hosted connect flow (JWT cached on the server like the extension).
								</p>
								<ConnectUrlForm experienceId={experienceId} accountId={acc.id} />
							</div>

							{!acc.uses_own_key ? (
								<div className="mt-4 border-t border-gray-a4 pt-3">
									<p className="text-3 font-medium text-gray-12">Cloud post (photo)</p>
									<p className="text-2 text-gray-10 mt-1">
										Forwards to Upload-Post via{" "}
										<code className="text-2 bg-gray-a3 px-1 rounded">/api/extension/upload-post/proxy</code> with your
										account.
									</p>
									<CloudUploadForm experienceId={experienceId} accountId={acc.id} />
								</div>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
