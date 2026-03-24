"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import type { Following, FollowingInsert, FollowingUpdate } from "@/lib/types/following";
import {
	experienceCreateFollowing,
	experienceDeleteFollowing,
	experienceUpdateFollowing,
} from "./following-actions";
import {
	IconCalendar,
	IconChevron,
	IconLink,
	IconMail,
	IconMapPin,
	IconPhone,
	IconPlus,
	IconStickyNote,
	IconTrash,
	IconUser,
} from "./following-icons";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PlatformOption = { id: string; name: string; slug: string };

export type FollowingDraft = {
	id: string;
	name: string;
	birthday: string;
	accounts: { platform_id: string; handle: string; url: string }[];
	emails: { email: string }[];
	phones: { phone_number: string }[];
	addresses: {
		address: string;
		address_2: string;
		city: string;
		state: string;
		zip: string;
		country: string;
	}[];
	notes: { note: string; access: string; scheduled: string }[];
};

function followingToDraft(f: Following): FollowingDraft {
	return {
		id: f.id,
		name: f.name,
		birthday: f.birthday ? String(f.birthday).slice(0, 10) : "",
		accounts: f.accounts.map((a) => ({
			platform_id: a.platform_id,
			handle: a.handle ?? "",
			url: a.url ?? "",
		})),
		emails: f.emails.map((e) => ({ email: e.email })),
		phones: f.phones.map((p) => ({ phone_number: p.phone_number })),
		addresses: f.addresses.map((a) => ({
			address: a.address ?? "",
			address_2: a.address_2 ?? "",
			city: a.city ?? "",
			state: a.state ?? "",
			zip: a.zip ?? "",
			country: a.country ?? "",
		})),
		notes: f.notes.map((n) => ({
			note: n.note,
			access: n.access ?? "",
			scheduled: n.scheduled ? String(n.scheduled).slice(0, 16) : "",
		})),
	};
}

function draftToUpdate(d: FollowingDraft): FollowingUpdate {
	const birthday = d.birthday.trim() ? d.birthday.trim() : null;
	return {
		name: d.name.trim(),
		birthday,
		accounts: d.accounts
			.filter((a) => UUID_RE.test(a.platform_id.trim()))
			.map((a) => ({
				platform_id: a.platform_id.trim(),
				handle: a.handle.trim() || null,
				url: a.url.trim() || null,
			})),
		emails: d.emails
			.filter((e) => e.email.trim())
			.map((e) => ({ email: e.email.trim() })),
		phones: d.phones
			.filter((p) => p.phone_number.trim())
			.map((p) => ({ phone_number: p.phone_number.trim() })),
		addresses: d.addresses
			.filter(
				(a) =>
					a.address.trim() ||
					a.city.trim() ||
					a.state.trim() ||
					a.zip.trim() ||
					a.country.trim(),
			)
			.map((a) => ({
				address: a.address.trim() || null,
				address_2: a.address_2.trim() || null,
				city: a.city.trim() || null,
				state: a.state.trim() || null,
				zip: a.zip.trim() || null,
				country: a.country.trim() || null,
			})),
		notes: d.notes
			.filter((n) => n.note.trim())
			.map((n) => ({
				note: n.note.trim(),
				access: n.access.trim() || null,
				scheduled: n.scheduled.trim() || null,
			})),
	};
}

function draftToInsert(d: FollowingDraft): FollowingInsert {
	const u = draftToUpdate(d);
	return {
		name: u.name as string,
		birthday: u.birthday,
		accounts: u.accounts,
		emails: u.emails,
		phones: u.phones,
		addresses: u.addresses,
		notes: u.notes,
	};
}

function emptyDraft(id: string, defaultPlatformId: string): FollowingDraft {
	return {
		id,
		name: "",
		birthday: "",
		accounts: defaultPlatformId ? [{ platform_id: defaultPlatformId, handle: "", url: "" }] : [],
		emails: [],
		phones: [],
		addresses: [],
		notes: [],
	};
}

function SubPanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
	return (
		<details className="group/sub border border-gray-a4 rounded-md bg-gray-a1 mt-2 overflow-hidden">
			<summary className="flex items-center gap-2 px-3 py-2.5 cursor-pointer text-3 font-medium text-gray-12 select-none list-none [&::-webkit-details-marker]:hidden hover:bg-gray-a3/50">
				{icon}
				<span>{title}</span>
				<IconChevron className="ml-auto transition-transform duration-200 group-open/sub:rotate-90" />
			</summary>
			<div className="px-3 pb-3 pt-0 border-t border-gray-a4/80">{children}</div>
		</details>
	);
}

function inputCls() {
	return "border border-gray-a4 rounded-md px-2.5 py-1.5 text-3 text-gray-12 bg-gray-a2 placeholder:text-gray-8 w-full min-w-0";
}

function btnSecondaryCls() {
	return "inline-flex items-center gap-1.5 text-3 px-3 py-1.5 rounded-md border border-gray-a4 text-gray-11 hover:bg-gray-a3 hover:text-gray-12";
}

function btnPrimaryCls() {
	return "inline-flex items-center gap-1.5 text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 font-medium hover:opacity-90 disabled:opacity-50";
}

function btnDangerCls() {
	return "inline-flex items-center gap-1 text-3 text-red-11 hover:underline p-1";
}

export function FollowingEditor({
	experienceId,
	initialList,
	platforms,
}: {
	experienceId: string;
	initialList: Following[];
	platforms: PlatformOption[];
}) {
	const router = useRouter();
	const defaultPlatformId = platforms[0]?.id ?? "";
	const [drafts, setDrafts] = useState<FollowingDraft[]>(() => initialList.map(followingToDraft));
	const [newDraft, setNewDraft] = useState<FollowingDraft>(() => emptyDraft("new", defaultPlatformId));
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	const syncKey = useMemo(
		() => initialList.map((f) => `${f.id}:${f.updated_at}`).join("|"),
		[initialList],
	);

	useEffect(() => {
		setDrafts(initialList.map(followingToDraft));
		setNewDraft(emptyDraft("new", defaultPlatformId));
	}, [syncKey, initialList, defaultPlatformId]);

	const updateDraft = useCallback((id: string, fn: (d: FollowingDraft) => FollowingDraft) => {
		setDrafts((prev) => prev.map((d) => (d.id === id ? fn(d) : d)));
	}, []);

	const run = useCallback(
		(fn: () => Promise<void>) => {
			setError(null);
			startTransition(() => {
				void (async () => {
					try {
						await fn();
						router.refresh();
					} catch (e) {
						setError(e instanceof Error ? e.message : "Something went wrong");
					}
				})();
			});
		},
		[router],
	);

	const handleSave = (id: string) => {
		const d = drafts.find((x) => x.id === id);
		if (!d || !d.name.trim()) {
			setError("Name is required.");
			return;
		}
		run(async () => {
			await experienceUpdateFollowing(experienceId, id, draftToUpdate(d));
		});
	};

	const handleDelete = (id: string) => {
		if (!confirm("Remove this person from Following?")) return;
		run(async () => {
			await experienceDeleteFollowing(experienceId, id);
		});
	};

	const handleAdd = () => {
		if (!newDraft.name.trim()) {
			setError("Enter a name to add someone.");
			return;
		}
		run(async () => {
			await experienceCreateFollowing(experienceId, draftToInsert(newDraft));
			setNewDraft(emptyDraft("new", defaultPlatformId));
		});
	};

	const renderDraftEditor = (d: FollowingDraft, isNew: boolean) => (
		<div className="flex flex-col gap-2 pt-2">
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<label className="text-3 text-gray-11 flex flex-col gap-1">
					<span className="flex items-center gap-1.5">
						<IconUser className="!text-gray-10" />
						Name
					</span>
					<input
						className={inputCls()}
						value={d.name}
						onChange={(e) =>
							isNew
								? setNewDraft((p) => ({ ...p, name: e.target.value }))
								: updateDraft(d.id, (x) => ({ ...x, name: e.target.value }))
						}
						placeholder="Full name"
					/>
				</label>
				<label className="text-3 text-gray-11 flex flex-col gap-1">
					<span className="flex items-center gap-1.5">
						<IconCalendar className="!text-gray-10" />
						Birthday
					</span>
					<input
						type="date"
						className={inputCls()}
						value={d.birthday}
						onChange={(e) =>
							isNew
								? setNewDraft((p) => ({ ...p, birthday: e.target.value }))
								: updateDraft(d.id, (x) => ({ ...x, birthday: e.target.value }))
						}
					/>
				</label>
			</div>

			<SubPanel title="Social accounts" icon={<IconLink />}>
				<p className="text-2 text-gray-10 mb-2">Platform, handle, and profile URL (same as the extension).</p>
				{d.accounts.map((row, i) => (
					<div key={`${d.id}-acc-${i}`} className="flex flex-wrap gap-2 items-end mb-2">
						<label className="flex flex-col gap-1 min-w-[140px] flex-1">
							<span className="text-2 text-gray-10">Platform</span>
							{platforms.length === 0 ? (
								<input
									className={inputCls()}
									value={row.platform_id}
									onChange={(e) => {
										const v = e.target.value;
										const fn = (x: FollowingDraft) => {
											const accounts = [...x.accounts];
											accounts[i] = { ...accounts[i], platform_id: v };
											return { ...x, accounts };
										};
										isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
									}}
									placeholder="Platform UUID"
								/>
							) : (
								<select
									className={inputCls()}
									value={row.platform_id}
									onChange={(e) => {
										const v = e.target.value;
										const fn = (x: FollowingDraft) => {
											const accounts = [...x.accounts];
											accounts[i] = { ...accounts[i], platform_id: v };
											return { ...x, accounts };
										};
										isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
									}}
								>
									{platforms.map((p) => (
										<option key={p.id} value={p.id}>
											{p.name}
										</option>
									))}
								</select>
							)}
						</label>
						<label className="flex flex-col gap-1 min-w-[100px] flex-1">
							<span className="text-2 text-gray-10">Handle</span>
							<input
								className={inputCls()}
								value={row.handle}
								onChange={(e) => {
									const v = e.target.value;
									const fn = (x: FollowingDraft) => {
										const accounts = [...x.accounts];
										accounts[i] = { ...accounts[i], handle: v };
										return { ...x, accounts };
									};
									isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
								}}
								placeholder="@user"
							/>
						</label>
						<label className="flex flex-col gap-1 min-w-[160px] flex-[2]">
							<span className="text-2 text-gray-10">URL</span>
							<input
								className={inputCls()}
								value={row.url}
								onChange={(e) => {
									const v = e.target.value;
									const fn = (x: FollowingDraft) => {
										const accounts = [...x.accounts];
										accounts[i] = { ...accounts[i], url: v };
										return { ...x, accounts };
									};
									isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
								}}
								placeholder="https://…"
							/>
						</label>
						<button
							type="button"
							className={btnDangerCls()}
							onClick={() => {
								const fn = (x: FollowingDraft) => ({
									...x,
									accounts: x.accounts.filter((_, j) => j !== i),
								});
								isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
							}}
							aria-label="Remove account row"
						>
							<IconTrash />
						</button>
					</div>
				))}
				<button
					type="button"
					className={btnSecondaryCls()}
					onClick={() => {
						const row = { platform_id: defaultPlatformId, handle: "", url: "" };
						const fn = (x: FollowingDraft) => ({ ...x, accounts: [...x.accounts, row] });
						isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
					}}
				>
					<IconPlus />
					Add account
				</button>
			</SubPanel>

			<SubPanel title="Email addresses" icon={<IconMail />}>
				{d.emails.map((row, i) => (
					<div key={`${d.id}-em-${i}`} className="flex gap-2 items-center mb-2">
						<input
							type="email"
							className={inputCls()}
							value={row.email}
							onChange={(e) => {
								const v = e.target.value;
								const fn = (x: FollowingDraft) => {
									const emails = [...x.emails];
									emails[i] = { email: v };
									return { ...x, emails };
								};
								isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
							}}
							placeholder="email@example.com"
						/>
						<button
							type="button"
							className={btnDangerCls()}
							onClick={() => {
								const fn = (x: FollowingDraft) => ({
									...x,
									emails: x.emails.filter((_, j) => j !== i),
								});
								isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
							}}
							aria-label="Remove email"
						>
							<IconTrash />
						</button>
					</div>
				))}
				<button
					type="button"
					className={btnSecondaryCls()}
					onClick={() => {
						const fn = (x: FollowingDraft) => ({ ...x, emails: [...x.emails, { email: "" }] });
						isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
					}}
				>
					<IconPlus />
					Add email
				</button>
			</SubPanel>

			<SubPanel title="Phone numbers" icon={<IconPhone />}>
				{d.phones.map((row, i) => (
					<div key={`${d.id}-ph-${i}`} className="flex gap-2 items-center mb-2">
						<input
							className={inputCls()}
							value={row.phone_number}
							onChange={(e) => {
								const v = e.target.value;
								const fn = (x: FollowingDraft) => {
									const phones = [...x.phones];
									phones[i] = { phone_number: v };
									return { ...x, phones };
								};
								isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
							}}
							placeholder="+1 …"
						/>
						<button
							type="button"
							className={btnDangerCls()}
							onClick={() => {
								const fn = (x: FollowingDraft) => ({
									...x,
									phones: x.phones.filter((_, j) => j !== i),
								});
								isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
							}}
							aria-label="Remove phone"
						>
							<IconTrash />
						</button>
					</div>
				))}
				<button
					type="button"
					className={btnSecondaryCls()}
					onClick={() => {
						const fn = (x: FollowingDraft) => ({ ...x, phones: [...x.phones, { phone_number: "" }] });
						isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
					}}
				>
					<IconPlus />
					Add phone
				</button>
			</SubPanel>

			<SubPanel title="Addresses" icon={<IconMapPin />}>
				{d.addresses.map((row, i) => (
					<div key={`${d.id}-ad-${i}`} className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 p-2 rounded-md bg-gray-a2/80 border border-gray-a4/60">
						{(
							[
								["address", "Street"],
								["address_2", "Line 2"],
								["city", "City"],
								["state", "State"],
								["zip", "ZIP"],
								["country", "Country"],
							] as const
						).map(([key, label]) => (
							<label key={key} className="text-2 text-gray-10 flex flex-col gap-0.5">
								{label}
								<input
									className={inputCls()}
									value={row[key]}
									onChange={(e) => {
										const v = e.target.value;
										const fn = (x: FollowingDraft) => {
											const addresses = [...x.addresses];
											addresses[i] = { ...addresses[i], [key]: v };
											return { ...x, addresses };
										};
										isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
									}}
								/>
							</label>
						))}
						<div className="sm:col-span-2 flex justify-end">
							<button
								type="button"
								className={btnDangerCls()}
								onClick={() => {
									const fn = (x: FollowingDraft) => ({
										...x,
										addresses: x.addresses.filter((_, j) => j !== i),
									});
									isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
								}}
							>
								Remove address
							</button>
						</div>
					</div>
				))}
				<button
					type="button"
					className={btnSecondaryCls()}
					onClick={() => {
						const blank = {
							address: "",
							address_2: "",
							city: "",
							state: "",
							zip: "",
							country: "",
						};
						const fn = (x: FollowingDraft) => ({ ...x, addresses: [...x.addresses, blank] });
						isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
					}}
				>
					<IconPlus />
					Add address
				</button>
			</SubPanel>

			<SubPanel title="Notes" icon={<IconStickyNote />}>
				{d.notes.map((row, i) => (
					<div key={`${d.id}-n-${i}`} className="mb-3 p-2 rounded-md bg-gray-a2/80 border border-gray-a4/60 space-y-2">
						<textarea
							className={`${inputCls()} min-h-[72px]`}
							value={row.note}
							onChange={(e) => {
								const v = e.target.value;
								const fn = (x: FollowingDraft) => {
									const notes = [...x.notes];
									notes[i] = { ...notes[i], note: v };
									return { ...x, notes };
								};
								isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
							}}
							placeholder="Note text"
						/>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
							<label className="text-2 text-gray-10 flex flex-col gap-0.5">
								Access
								<input
									className={inputCls()}
									value={row.access}
									onChange={(e) => {
										const v = e.target.value;
										const fn = (x: FollowingDraft) => {
											const notes = [...x.notes];
											notes[i] = { ...notes[i], access: v };
											return { ...x, notes };
										};
										isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
									}}
								/>
							</label>
							<label className="text-2 text-gray-10 flex flex-col gap-0.5">
								Scheduled
								<input
									type="datetime-local"
									className={inputCls()}
									value={row.scheduled}
									onChange={(e) => {
										const v = e.target.value;
										const fn = (x: FollowingDraft) => {
											const notes = [...x.notes];
											notes[i] = { ...notes[i], scheduled: v };
											return { ...x, notes };
										};
										isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
									}}
								/>
							</label>
						</div>
						<button
							type="button"
							className={btnDangerCls()}
							onClick={() => {
								const fn = (x: FollowingDraft) => ({
									...x,
									notes: x.notes.filter((_, j) => j !== i),
								});
								isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
							}}
						>
							Remove note
						</button>
					</div>
				))}
				<button
					type="button"
					className={btnSecondaryCls()}
					onClick={() => {
						const fn = (x: FollowingDraft) => ({
							...x,
							notes: [...x.notes, { note: "", access: "", scheduled: "" }],
						});
						isNew ? setNewDraft(fn) : updateDraft(d.id, fn);
					}}
				>
					<IconPlus />
					Add note
				</button>
			</SubPanel>

			<div className="flex flex-wrap gap-2 pt-2">
				{isNew ? (
					<button type="button" className={btnPrimaryCls()} disabled={pending} onClick={handleAdd}>
						{pending ? "Saving…" : "Create contact"}
					</button>
				) : (
					<button type="button" className={btnPrimaryCls()} disabled={pending} onClick={() => handleSave(d.id)}>
						{pending ? "Saving…" : "Save changes"}
					</button>
				)}
			</div>
		</div>
	);

	const countBadges = (d: FollowingDraft) => (
		<div className="flex flex-wrap gap-1.5 ml-2">
			{d.accounts.filter((a) => UUID_RE.test(a.platform_id.trim())).length > 0 ? (
				<span className="text-2 px-2 py-0.5 rounded-full bg-gray-a4 text-gray-11">
					{d.accounts.filter((a) => UUID_RE.test(a.platform_id.trim())).length} accounts
				</span>
			) : null}
			{d.emails.filter((e) => e.email.trim()).length > 0 ? (
				<span className="text-2 px-2 py-0.5 rounded-full bg-gray-a4 text-gray-11">{d.emails.filter((e) => e.email.trim()).length} emails</span>
			) : null}
			{d.phones.filter((p) => p.phone_number.trim()).length > 0 ? (
				<span className="text-2 px-2 py-0.5 rounded-full bg-gray-a4 text-gray-11">
					{d.phones.filter((p) => p.phone_number.trim()).length} phones
				</span>
			) : null}
			{d.addresses.length > 0 ? (
				<span className="text-2 px-2 py-0.5 rounded-full bg-gray-a4 text-gray-11">{d.addresses.length} addresses</span>
			) : null}
			{d.notes.filter((n) => n.note.trim()).length > 0 ? (
				<span className="text-2 px-2 py-0.5 rounded-full bg-gray-a4 text-gray-11">{d.notes.filter((n) => n.note.trim()).length} notes</span>
			) : null}
		</div>
	);

	return (
		<div className="flex flex-col gap-4">
			{error ? (
				<div className="text-3 text-red-11 border border-red-a6 rounded-lg px-3 py-2 bg-red-a2" role="alert">
					{error}
				</div>
			) : null}

			<details className="group/add border border-gray-a4 rounded-lg bg-gray-a2 overflow-hidden">
				<summary className="flex items-center gap-2 px-4 py-3 cursor-pointer text-4 font-medium text-gray-12 select-none list-none [&::-webkit-details-marker]:hidden hover:bg-gray-a3/40">
					<IconPlus className="!text-gray-11" />
					Add someone
					<IconChevron className="ml-auto transition-transform duration-200 group-open/add:rotate-90" />
				</summary>
				<div className="px-4 pb-4 border-t border-gray-a4">{renderDraftEditor(newDraft, true)}</div>
			</details>

			{drafts.length === 0 ? (
				<p className="text-3 text-gray-10 border border-dashed border-gray-a4 rounded-lg p-8 text-center bg-gray-a2/50">
					No contacts yet. Use <strong className="text-gray-11">Add someone</strong> above or sync from the{" "}
					<a
						href="https://github.com/contentrewardsai/ExtensibleContentExtension"
						className="text-gray-12 underline"
						target="_blank"
						rel="noreferrer"
					>
						Chrome extension
					</a>
					.
				</p>
			) : (
				<div className="flex flex-col gap-3">
					{drafts.map((d) => (
						<details
							key={d.id}
							className="group/card border border-gray-a4 rounded-lg bg-gray-a2 overflow-hidden shadow-sm"
						>
							<summary className="flex flex-wrap items-center gap-2 px-4 py-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-gray-a3/40">
								<IconChevron className="transition-transform duration-200 group-open/card:rotate-90" />
								<IconUser className="!text-gray-11" />
								<span className="text-5 font-semibold text-gray-12">{d.name.trim() || "Unnamed"}</span>
								{countBadges(d)}
								<button
									type="button"
									className={`${btnDangerCls()} ml-auto`}
									onClick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										handleDelete(d.id);
									}}
									disabled={pending}
									aria-label={`Delete ${d.name || "contact"}`}
								>
									<IconTrash />
									Remove
								</button>
							</summary>
							<div className="px-4 pb-4 border-t border-gray-a4">{renderDraftEditor(d, false)}</div>
						</details>
					))}
				</div>
			)}
		</div>
	);
}
