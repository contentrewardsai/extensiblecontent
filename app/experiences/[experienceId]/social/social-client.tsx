"use client";

import { useActionState, useMemo, useState } from "react";
import {
	ghlCancelScheduledAction,
	ghlPostNowAction,
	ghlSchedulePostAction,
} from "./social-actions";

export interface SocialTarget {
	connectionId: string;
	companyId: string;
	locationId: string;
	locationName: string;
	channels: Array<{
		id: string;
		platform: string;
		displayName: string;
	}>;
}

export interface ScheduledRow {
	id: string;
	locationId: string;
	summary: string;
	accountIds: string[];
	scheduledFor: string;
	status: string;
	attempts: number;
	lastError: string | null;
	ghlPostId: string | null;
	createdAt: string;
}

function ActionStatus({
	state,
}: {
	state: { ok?: boolean; message?: string; error?: string } | null;
}) {
	if (!state) return null;
	if (state.ok === false && state.error) {
		return <p className="text-2 text-red-11 mt-2">{state.error}</p>;
	}
	if (state.ok === true && state.message) {
		return <p className="text-2 text-green-11 mt-2">{state.message}</p>;
	}
	return null;
}

export function SocialComposer({
	experienceId,
	targets,
}: {
	experienceId: string;
	targets: SocialTarget[];
}) {
	const [selectedLocation, setSelectedLocation] = useState<string>(
		targets[0]?.locationId ?? "",
	);
	const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
	const [summary, setSummary] = useState("");
	const [media, setMedia] = useState("");
	const [scheduledFor, setScheduledFor] = useState("");

	const [postNowState, postNowAction, postNowPending] = useActionState(
		ghlPostNowAction,
		null,
	);
	const [scheduleState, scheduleAction, schedulePending] = useActionState(
		ghlSchedulePostAction,
		null,
	);

	const activeTarget = useMemo(
		() => targets.find((t) => t.locationId === selectedLocation),
		[targets, selectedLocation],
	);

	const toggleChannel = (id: string) => {
		setSelectedChannels((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const changeLocation = (id: string) => {
		setSelectedLocation(id);
		setSelectedChannels(new Set());
	};

	const accountIdsCsv = useMemo(
		() => Array.from(selectedChannels).join(","),
		[selectedChannels],
	);
	const canSubmit =
		selectedLocation && summary.trim() && selectedChannels.size > 0;

	if (targets.length === 0) {
		return (
			<div className="border border-gray-a4 rounded-lg p-6 bg-gray-a2">
				<p className="text-3 text-gray-11">
					Connect a GoHighLevel account under <strong>Integrations</strong>{" "}
					and make sure its sub-accounts have social channels connected in GHL
					before posting from here.
				</p>
			</div>
		);
	}

	return (
		<div className="border border-gray-a4 rounded-lg p-5 bg-gray-a2 flex flex-col gap-4">
			<div>
				<label className="text-2 text-gray-11 block mb-1">
					GoHighLevel sub-account
				</label>
				<select
					value={selectedLocation}
					onChange={(e) => changeLocation(e.target.value)}
					className="w-full text-3 px-3 py-2 rounded-md border border-gray-a4 bg-gray-a1 text-gray-12"
				>
					{targets.map((t) => (
						<option key={t.locationId} value={t.locationId}>
							{t.locationName} — {t.companyId}
						</option>
					))}
				</select>
			</div>

			<div>
				<p className="text-2 text-gray-11 mb-1">Social channels</p>
				{activeTarget && activeTarget.channels.length === 0 ? (
					<p className="text-2 text-gray-10 italic">
						No social channels cached yet. Open this location&apos;s Social
						Planner in GHL, or call{" "}
						<code className="text-2 bg-gray-a3 px-1 rounded">
							/api/extension/ghl/social/accounts
						</code>{" "}
						once to cache them.
					</p>
				) : (
					<div className="flex flex-wrap gap-2">
						{activeTarget?.channels.map((ch) => {
							const active = selectedChannels.has(ch.id);
							return (
								<button
									type="button"
									key={ch.id}
									onClick={() => toggleChannel(ch.id)}
									className={`text-2 px-3 py-1.5 rounded-md border ${
										active
											? "border-gray-12 bg-gray-a4 text-gray-12"
											: "border-gray-a4 bg-gray-a1 text-gray-11 hover:bg-gray-a3"
									}`}
								>
									<span className="uppercase tracking-wide mr-2 text-1 text-gray-10">
										{ch.platform}
									</span>
									{ch.displayName}
								</button>
							);
						})}
					</div>
				)}
			</div>

			<div>
				<label className="text-2 text-gray-11 block mb-1">Post text</label>
				<textarea
					value={summary}
					onChange={(e) => setSummary(e.target.value)}
					rows={4}
					placeholder="What do you want to publish?"
					className="w-full text-3 px-3 py-2 rounded-md border border-gray-a4 bg-gray-a1 text-gray-12 resize-y"
				/>
			</div>

			<div>
				<label className="text-2 text-gray-11 block mb-1">
					Media URLs{" "}
					<span className="text-1 text-gray-10">
						(one per line, optional — must be https://)
					</span>
				</label>
				<textarea
					value={media}
					onChange={(e) => setMedia(e.target.value)}
					rows={2}
					placeholder="https://cdn.example.com/image.jpg"
					className="w-full text-3 px-3 py-2 rounded-md border border-gray-a4 bg-gray-a1 text-gray-12 font-mono resize-y"
				/>
			</div>

			<div className="flex flex-col gap-3 border-t border-gray-a4 pt-4">
				<form action={postNowAction} className="flex flex-wrap items-center gap-2">
					<input type="hidden" name="experienceId" value={experienceId} />
					<input type="hidden" name="locationId" value={selectedLocation} />
					<input type="hidden" name="summary" value={summary} />
					<input type="hidden" name="accountIds" value={accountIdsCsv} />
					<input type="hidden" name="media" value={media} />
					<button
						type="submit"
						disabled={!canSubmit || postNowPending}
						className="text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 disabled:opacity-40"
					>
						{postNowPending ? "Posting…" : "Post now"}
					</button>
					<ActionStatus state={postNowState} />
				</form>

				<form action={scheduleAction} className="flex flex-wrap items-center gap-2">
					<input type="hidden" name="experienceId" value={experienceId} />
					<input type="hidden" name="locationId" value={selectedLocation} />
					<input type="hidden" name="summary" value={summary} />
					<input type="hidden" name="accountIds" value={accountIdsCsv} />
					<input type="hidden" name="media" value={media} />
					<input
						type="datetime-local"
						name="scheduledFor"
						value={scheduledFor}
						onChange={(e) => setScheduledFor(e.target.value)}
						className="text-3 px-2 py-1.5 rounded-md border border-gray-a4 bg-gray-a1 text-gray-12"
					/>
					<button
						type="submit"
						disabled={!canSubmit || !scheduledFor || schedulePending}
						className="text-3 px-4 py-2 rounded-md border border-gray-a4 text-gray-12 hover:bg-gray-a3 disabled:opacity-40"
					>
						{schedulePending ? "Scheduling…" : "Schedule"}
					</button>
					<ActionStatus state={scheduleState} />
				</form>
			</div>
		</div>
	);
}

export function ScheduledPostsList({
	experienceId,
	rows,
}: {
	experienceId: string;
	rows: ScheduledRow[];
}) {
	const [cancelState, cancelAction, cancelPending] = useActionState(
		ghlCancelScheduledAction,
		null,
	);

	if (rows.length === 0) {
		return (
			<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-4 bg-gray-a2">
				No scheduled or recent posts yet.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<ActionStatus state={cancelState} />
			<ul className="flex flex-col gap-2">
				{rows.map((r) => (
					<li
						key={r.id}
						className="border border-gray-a4 rounded-md p-3 bg-gray-a2 flex flex-col gap-1"
					>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div className="flex items-center gap-2">
								<StatusBadge status={r.status} />
								<span className="text-2 text-gray-11">
									{new Date(r.scheduledFor).toLocaleString()}
								</span>
								<span className="text-2 text-gray-10 font-mono">
									{r.locationId}
								</span>
							</div>
							{r.status === "pending" && (
								<form action={cancelAction}>
									<input
										type="hidden"
										name="experienceId"
										value={experienceId}
									/>
									<input
										type="hidden"
										name="scheduledId"
										value={r.id}
									/>
									<button
										type="submit"
										disabled={cancelPending}
										className="text-2 text-red-11 hover:underline disabled:opacity-40"
									>
										Cancel
									</button>
								</form>
							)}
						</div>
						<p className="text-3 text-gray-12 whitespace-pre-wrap">
							{r.summary}
						</p>
						{r.accountIds.length > 0 && (
							<p className="text-2 text-gray-10">
								{r.accountIds.length} channel
								{r.accountIds.length === 1 ? "" : "s"}
							</p>
						)}
						{r.lastError && (
							<p className="text-2 text-red-11">
								Error: {r.lastError}{" "}
								{r.attempts > 0 && `(attempt ${r.attempts})`}
							</p>
						)}
						{r.ghlPostId && (
							<p className="text-2 text-gray-10 font-mono">
								GHL post {r.ghlPostId}
							</p>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const styles: Record<string, string> = {
		pending: "bg-gray-a3 text-gray-11",
		in_progress: "bg-blue-a3 text-blue-11",
		succeeded: "bg-green-a3 text-green-11",
		failed: "bg-red-a3 text-red-11",
		cancelled: "bg-gray-a3 text-gray-10",
	};
	const cls = styles[status] ?? "bg-gray-a3 text-gray-11";
	return (
		<span className={`text-1 uppercase tracking-wide px-2 py-0.5 rounded ${cls}`}>
			{status.replace("_", " ")}
		</span>
	);
}
