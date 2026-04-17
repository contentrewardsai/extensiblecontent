"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
	acceptProjectInviteAction,
	type AcceptProjectInviteState,
} from "../../../experience-actions";

export function InviteAcceptClient({ experienceId, token }: { experienceId: string; token: string }) {
	const initial: AcceptProjectInviteState | null = null;
	const [state, formAction, pending] = useActionState(acceptProjectInviteAction, initial);

	if (state?.ok) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-3 text-green-11">You're now in! Role: {state.role}.</p>
				<Link
					href={`/experiences/${experienceId}/projects/${state.project_id}`}
					className="text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 self-start"
				>
					Open project
				</Link>
			</div>
		);
	}

	return (
		<form action={formAction} className="flex flex-col gap-3">
			<input type="hidden" name="experienceId" value={experienceId} />
			<input type="hidden" name="token" value={token} />
			<button
				type="submit"
				disabled={pending}
				className="text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 disabled:opacity-50 self-start"
			>
				{pending ? "Accepting…" : "Accept invite"}
			</button>
			{state && state.ok === false ? <p className="text-2 text-red-11">{state.error}</p> : null}
		</form>
	);
}
