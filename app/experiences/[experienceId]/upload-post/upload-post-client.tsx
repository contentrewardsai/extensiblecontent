"use client";

import { useActionState } from "react";
import { refreshConnectUrlAction, uploadPostCloudAction } from "../experience-actions";

export function ConnectUrlForm({ experienceId, accountId }: { experienceId: string; accountId: string }) {
	const [state, formAction, pending] = useActionState(refreshConnectUrlAction, null);

	return (
		<div className="mt-2 space-y-2">
			<form action={formAction} className="flex flex-wrap items-center gap-2">
				<input type="hidden" name="experienceId" value={experienceId} />
				<input type="hidden" name="accountId" value={accountId} />
				<button
					type="submit"
					disabled={pending}
					className="text-3 px-3 py-1.5 rounded-md border border-gray-a4 text-gray-12 hover:bg-gray-a3 disabled:opacity-50"
				>
					{pending ? "…" : "Get connect link"}
				</button>
			</form>
			{state?.error ? <p className="text-2 text-red-11">{state.error}</p> : null}
			{state?.url ? (
				<a href={state.url} target="_blank" rel="noopener noreferrer" className="text-3 text-gray-12 underline break-all">
					Open Upload-Post connect
				</a>
			) : null}
		</div>
	);
}

export function CloudUploadForm({ experienceId, accountId }: { experienceId: string; accountId: string }) {
	const [state, formAction, pending] = useActionState(uploadPostCloudAction, null);

	return (
		<form action={formAction} encType="multipart/form-data" className="flex flex-col gap-2 mt-3 max-w-md">
			<input type="hidden" name="experienceId" value={experienceId} />
			<input type="hidden" name="account_id" value={accountId} />
			<input type="hidden" name="endpoint" value="photos" />
			<label className="text-2 text-gray-11 flex flex-col gap-1">
				File (field name <code className="text-2">file</code> — adjust if your Upload-Post integration expects another name)
				<input type="file" name="file" required className="text-3 text-gray-12" />
			</label>
			<button
				type="submit"
				disabled={pending}
				className="self-start text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 disabled:opacity-50"
			>
				{pending ? "Uploading…" : "Post photo (cloud proxy)"}
			</button>
			{state && !state.ok ? <p className="text-2 text-red-11">{state.error}</p> : null}
			{state && state.ok ? (
				<pre className="text-2 font-mono text-gray-11 max-h-48 overflow-auto border border-gray-a4 rounded p-2 bg-gray-a1">
					{JSON.stringify(state.json, null, 2)}
				</pre>
			) : null}
		</form>
	);
}
