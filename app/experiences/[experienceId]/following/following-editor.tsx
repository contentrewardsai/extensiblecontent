"use client";

import { useRouter } from "next/navigation";
import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	useTransition,
	type ReactNode,
	type SyntheticEvent,
} from "react";
import type { Following, FollowingInsert, FollowingUpdate } from "@/lib/types/following";
import { BirthdaySelect } from "./birthday-select";
import {
	experienceCreateFollowing,
	experienceDeleteFollowing,
	experienceUpdateFollowing,
} from "./following-actions";
import { IconChevron, IconTrash } from "./following-icons";
import { hasBrandTile, PlatformBrandIcon, platformProfileUrl } from "./platform-brand-icons";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PlatformOption = { id: string; name: string; slug: string };

type AccountDraft = { platform_id: string; handle: string; url: string };
type EmailDraft = { email: string };
type PhoneDraft = { phone_number: string };
type AddressDraft = {
	address: string;
	address_2: string;
	city: string;
	state: string;
	zip: string;
	country: string;
};
type NoteDraft = { note: string; access: string; scheduled: string };

export type FollowingDraft = {
	id: string;
	name: string;
	birthday: string;
	accounts: AccountDraft[];
	emails: EmailDraft[];
	phones: PhoneDraft[];
	addresses: AddressDraft[];
	notes: NoteDraft[];
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

function emptyDraft(id: string): FollowingDraft {
	return {
		id,
		name: "",
		birthday: "",
		accounts: [],
		emails: [],
		phones: [],
		addresses: [],
		notes: [],
	};
}

const COUNTRY_CODES: { code: string; label: string }[] = [
	{ code: "+1", label: "+1 US/Canada" },
	{ code: "+44", label: "+44 UK" },
	{ code: "+61", label: "+61 AU" },
	{ code: "+33", label: "+33 FR" },
	{ code: "+49", label: "+49 DE" },
	{ code: "+34", label: "+34 ES" },
	{ code: "+39", label: "+39 IT" },
	{ code: "+31", label: "+31 NL" },
	{ code: "+81", label: "+81 JP" },
	{ code: "+82", label: "+82 KR" },
	{ code: "+86", label: "+86 CN" },
	{ code: "+91", label: "+91 IN" },
	{ code: "+52", label: "+52 MX" },
	{ code: "+55", label: "+55 BR" },
];

const inputCls =
	"border border-gray-a4 rounded-md px-2.5 py-1.5 text-3 text-gray-12 bg-gray-a2 placeholder:text-gray-9 w-full min-w-0 focus:outline-none focus:border-blue-8";

const selectCls =
	"border border-gray-a4 rounded-md px-2 py-1.5 text-3 text-gray-12 bg-gray-a2 focus:outline-none focus:border-blue-8";

const primaryBtnCls =
	"inline-flex items-center justify-center gap-1 text-3 px-3 py-1.5 rounded-md bg-blue-9 text-white font-medium hover:bg-blue-10 disabled:opacity-50";

const secondaryBtnCls =
	"inline-flex items-center gap-1.5 text-3 px-3 py-1.5 rounded-md border border-gray-a5 text-gray-12 bg-gray-a2 hover:bg-gray-a3 disabled:opacity-50";

const iconBtnCls =
	"inline-grid place-items-center h-7 w-7 rounded-md border border-gray-a4 text-gray-11 hover:bg-gray-a3 hover:text-gray-12 disabled:opacity-50";

function SectionDisclosure({
	title,
	defaultOpen = false,
	children,
}: {
	title: string;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	return (
		<details
			className="group/section"
			{...(defaultOpen ? { open: true } : {})}
		>
			<summary className="flex items-center gap-1.5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden py-1.5 text-3 font-semibold text-gray-12 hover:text-gray-12">
				<span>{title}</span>
				<IconChevron className="!h-3.5 !w-3.5 transition-transform duration-200 group-open/section:rotate-90 text-gray-10" />
			</summary>
			<div className="pt-2 pb-3">{children}</div>
		</details>
	);
}

function CollapsedBrandStack({
	accounts,
	platforms,
}: {
	accounts: AccountDraft[];
	platforms: PlatformOption[];
}) {
	const slugById = useMemo(() => {
		const m = new Map<string, { slug: string; name: string }>();
		for (const p of platforms) m.set(p.id, { slug: p.slug, name: p.name });
		return m;
	}, [platforms]);
	const valid = accounts.filter((a) => UUID_RE.test(a.platform_id.trim()));
	if (valid.length === 0) return null;
	const sorted = [...valid].sort((a, b) => {
		const aBrand = hasBrandTile(slugById.get(a.platform_id)?.slug) ? 0 : 1;
		const bBrand = hasBrandTile(slugById.get(b.platform_id)?.slug) ? 0 : 1;
		return aBrand - bBrand;
	});
	const cap = 8;
	const shown = sorted.slice(0, cap);
	const overflow = sorted.length - shown.length;
	const stop = (e: SyntheticEvent) => {
		e.stopPropagation();
	};
	return (
		<div className="flex items-center gap-1 flex-wrap">
			{shown.map((a, i) => {
				const meta = slugById.get(a.platform_id);
				const url = a.url?.trim() || platformProfileUrl(meta?.slug, a.handle) || "";
				const tile = (
					<PlatformBrandIcon
						slug={meta?.slug}
						name={meta?.name}
						size="md"
					/>
				);
				if (!url) {
					return <span key={`${a.platform_id}-${i}`}>{tile}</span>;
				}
				return (
					<a
						key={`${a.platform_id}-${i}`}
						href={url}
						target="_blank"
						rel="noreferrer"
						onClick={stop}
						onMouseDown={stop}
						className="inline-flex hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-8 rounded-md"
						aria-label={meta?.name ? `Open ${meta.name} profile` : "Open profile"}
					>
						{tile}
					</a>
				);
			})}
			{overflow > 0 ? (
				<span className="h-7 min-w-7 px-1 rounded-md inline-grid place-items-center bg-gray-a5 text-2 font-semibold text-gray-12">
					+{overflow}
				</span>
			) : null}
		</div>
	);
}

function PhonesSection({
	d,
	commit,
	disabled,
}: {
	d: FollowingDraft;
	commit: (next: FollowingDraft) => void;
	disabled?: boolean;
}) {
	const [code, setCode] = useState("+1");
	const [value, setValue] = useState("");
	const canAdd = value.trim().length > 0;

	const addPhone = () => {
		if (!canAdd) return;
		const full = `${code} ${value.trim()}`.trim();
		const next: FollowingDraft = { ...d, phones: [...d.phones, { phone_number: full }] };
		commit(next);
		setValue("");
	};

	const removePhone = (i: number) => {
		const next: FollowingDraft = { ...d, phones: d.phones.filter((_, j) => j !== i) };
		commit(next);
	};

	return (
		<SectionDisclosure title="Phone numbers" defaultOpen>
			<div className="flex flex-col gap-2">
				{d.phones.map((p, i) => (
					<div key={`ph-${i}`} className="flex items-center gap-2 border border-gray-a4 rounded-md px-3 py-2 bg-gray-a1">
						<a
							href={`tel:${p.phone_number.replace(/[^+\d]/g, "")}`}
							className="flex-1 text-3 text-blue-11 hover:underline underline-offset-2 truncate"
						>
							{p.phone_number}
						</a>
						<button
							type="button"
							className={iconBtnCls}
							onClick={() => removePhone(i)}
							disabled={disabled}
							aria-label="Remove phone"
						>
							<IconTrash />
						</button>
					</div>
				))}
				<div className="flex items-center gap-2">
					<select
						className={selectCls}
						value={code}
						onChange={(e) => setCode(e.target.value)}
						disabled={disabled}
						aria-label="Country code"
					>
						{COUNTRY_CODES.map((c) => (
							<option key={c.code} value={c.code}>
								{c.label}
							</option>
						))}
					</select>
					<input
						className={inputCls}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								addPhone();
							}
						}}
						placeholder=""
						inputMode="tel"
						disabled={disabled}
					/>
					<button
						type="button"
						className={primaryBtnCls}
						onClick={addPhone}
						disabled={disabled || !canAdd}
					>
						Add
					</button>
				</div>
			</div>
		</SectionDisclosure>
	);
}

function EmailsSection({
	d,
	commit,
	disabled,
}: {
	d: FollowingDraft;
	commit: (next: FollowingDraft) => void;
	disabled?: boolean;
}) {
	const [value, setValue] = useState("");
	const canAdd = value.trim().length > 0;

	const addEmail = () => {
		if (!canAdd) return;
		const next: FollowingDraft = { ...d, emails: [...d.emails, { email: value.trim() }] };
		commit(next);
		setValue("");
	};

	const removeEmail = (i: number) => {
		const next: FollowingDraft = { ...d, emails: d.emails.filter((_, j) => j !== i) };
		commit(next);
	};

	return (
		<SectionDisclosure title="Email addresses" defaultOpen>
			<div className="flex flex-col gap-2">
				{d.emails.map((e, i) => (
					<div key={`em-${i}`} className="flex items-center gap-2 border border-gray-a4 rounded-md px-3 py-2 bg-gray-a1">
						<a
							href={`mailto:${e.email}`}
							className="flex-1 text-3 text-blue-11 hover:underline underline-offset-2 truncate"
						>
							{e.email}
						</a>
						<button
							type="button"
							className={iconBtnCls}
							onClick={() => removeEmail(i)}
							disabled={disabled}
							aria-label="Remove email"
						>
							<IconTrash />
						</button>
					</div>
				))}
				<div className="flex items-center gap-2">
					<input
						type="email"
						className={inputCls}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								addEmail();
							}
						}}
						placeholder="Email address"
						disabled={disabled}
					/>
					<button
						type="button"
						className={primaryBtnCls}
						onClick={addEmail}
						disabled={disabled || !canAdd}
					>
						Add
					</button>
				</div>
			</div>
		</SectionDisclosure>
	);
}

function AddressesSection({
	d,
	update,
	commit,
	disabled,
}: {
	d: FollowingDraft;
	update: (next: FollowingDraft) => void;
	commit: (next: FollowingDraft) => void;
	disabled?: boolean;
}) {
	const fields: [keyof AddressDraft, string][] = [
		["address", "Address"],
		["address_2", "Address 2"],
		["city", "City"],
		["state", "State"],
		["zip", "ZIP"],
		["country", "Country"],
	];

	const addBlank = () => {
		const blank: AddressDraft = {
			address: "",
			address_2: "",
			city: "",
			state: "",
			zip: "",
			country: "",
		};
		commit({ ...d, addresses: [...d.addresses, blank] });
	};

	return (
		<SectionDisclosure title="Addresses" defaultOpen>
			<div className="flex flex-col gap-3">
				{d.addresses.map((a, i) => (
					<div key={`ad-${i}`} className="flex flex-col gap-2 p-3 border border-gray-a4 rounded-md bg-gray-a1">
						{fields.map(([key, label]) => (
							<input
								key={key}
								className={inputCls}
								value={a[key]}
								placeholder={label}
								onChange={(e) => {
									const v = e.target.value;
									const addresses = [...d.addresses];
									addresses[i] = { ...addresses[i], [key]: v };
									update({ ...d, addresses });
								}}
								onBlur={() => commit(d)}
								disabled={disabled}
							/>
						))}
						<div className="flex justify-end">
							<button
								type="button"
								className={iconBtnCls}
								onClick={() => commit({ ...d, addresses: d.addresses.filter((_, j) => j !== i) })}
								disabled={disabled}
								aria-label="Remove address"
							>
								<IconTrash />
							</button>
						</div>
					</div>
				))}
				<div className="flex flex-col gap-2 p-3 border border-dashed border-gray-a4 rounded-md bg-gray-a1/50">
					{fields.map(([, label]) => (
						<input key={label} className={inputCls} placeholder={label} disabled readOnly />
					))}
					<button
						type="button"
						className={`${primaryBtnCls} w-full`}
						onClick={addBlank}
						disabled={disabled}
					>
						Add
					</button>
				</div>
			</div>
		</SectionDisclosure>
	);
}

function NotesSection({
	d,
	update,
	commit,
	disabled,
}: {
	d: FollowingDraft;
	update: (next: FollowingDraft) => void;
	commit: (next: FollowingDraft) => void;
	disabled?: boolean;
}) {
	const [text, setText] = useState("");
	const [scheduled, setScheduled] = useState("");
	const canAdd = text.trim().length > 0;

	const addNote = () => {
		if (!canAdd) return;
		const next: FollowingDraft = {
			...d,
			notes: [...d.notes, { note: text.trim(), access: "", scheduled: scheduled.trim() }],
		};
		commit(next);
		setText("");
		setScheduled("");
	};

	return (
		<SectionDisclosure title="Notes" defaultOpen>
			<div className="flex flex-col gap-3">
				<div className="flex flex-col gap-2">
					<textarea
						className={`${inputCls} min-h-[72px]`}
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder="Add a note…"
						disabled={disabled}
					/>
					<label className="text-2 text-gray-11 flex flex-col gap-1">
						Scheduled (optional)
						<input
							type="datetime-local"
							className={inputCls}
							value={scheduled}
							onChange={(e) => setScheduled(e.target.value)}
							disabled={disabled}
						/>
					</label>
					<div>
						<button
							type="button"
							className={primaryBtnCls}
							onClick={addNote}
							disabled={disabled || !canAdd}
						>
							Add note
						</button>
					</div>
				</div>

				{d.notes.map((n, i) => (
					<div key={`n-${i}`} className="flex flex-col gap-2 p-3 border border-gray-a4 rounded-md bg-gray-a1">
						<textarea
							className={`${inputCls} min-h-[56px]`}
							value={n.note}
							onChange={(e) => {
								const v = e.target.value;
								const notes = [...d.notes];
								notes[i] = { ...notes[i], note: v };
								update({ ...d, notes });
							}}
							onBlur={() => commit(d)}
							disabled={disabled}
						/>
						<div className="flex items-center gap-2">
							<input
								type="datetime-local"
								className={inputCls}
								value={n.scheduled}
								onChange={(e) => {
									const v = e.target.value;
									const notes = [...d.notes];
									notes[i] = { ...notes[i], scheduled: v };
									update({ ...d, notes });
								}}
								onBlur={() => commit(d)}
								disabled={disabled}
							/>
							<button
								type="button"
								className={iconBtnCls}
								onClick={() => commit({ ...d, notes: d.notes.filter((_, j) => j !== i) })}
								disabled={disabled}
								aria-label="Remove note"
							>
								<IconTrash />
							</button>
						</div>
					</div>
				))}
			</div>
		</SectionDisclosure>
	);
}

function SocialAccountsSection({
	d,
	commit,
	platforms,
	disabled,
}: {
	d: FollowingDraft;
	commit: (next: FollowingDraft) => void;
	platforms: PlatformOption[];
	disabled?: boolean;
}) {
	const defaultPlatformId = platforms[0]?.id ?? "";
	const [platformId, setPlatformId] = useState(defaultPlatformId);
	const [handle, setHandle] = useState("");
	const [urlOverride, setUrlOverride] = useState("");
	const canAdd = handle.trim().length > 0 && UUID_RE.test(platformId.trim());

	useEffect(() => {
		if (!platformId && defaultPlatformId) setPlatformId(defaultPlatformId);
	}, [defaultPlatformId, platformId]);

	const platformById = useMemo(() => {
		const m = new Map<string, PlatformOption>();
		for (const p of platforms) m.set(p.id, p);
		return m;
	}, [platforms]);

	const add = () => {
		if (!canAdd) return;
		const p = platformById.get(platformId);
		const cleanedHandle = handle.trim().replace(/^@+/, "");
		const derived = platformProfileUrl(p?.slug, cleanedHandle) ?? "";
		const row: AccountDraft = {
			platform_id: platformId,
			handle: cleanedHandle,
			url: urlOverride.trim() || derived,
		};
		commit({ ...d, accounts: [...d.accounts, row] });
		setHandle("");
		setUrlOverride("");
	};

	const removeAt = (i: number) => {
		commit({ ...d, accounts: d.accounts.filter((_, j) => j !== i) });
	};

	return (
		<SectionDisclosure title="Social accounts" defaultOpen>
			<div className="flex flex-col gap-2">
				{d.accounts.map((a, i) => {
					const p = platformById.get(a.platform_id);
					const url = a.url?.trim() || platformProfileUrl(p?.slug, a.handle) || "";
					const displayHandle = a.handle ? (a.handle.startsWith("@") ? a.handle : `@${a.handle}`) : p?.name || "profile";
					return (
						<div
							key={`acc-${i}`}
							className="flex items-center gap-3 p-2 border border-gray-a4 rounded-md bg-gray-a1"
						>
							<PlatformBrandIcon slug={p?.slug} name={p?.name} size="md" />
							{url ? (
								<a
									href={url}
									target="_blank"
									rel="noreferrer"
									className="flex-1 text-3 text-gray-12 hover:text-blue-11 hover:underline underline-offset-2 truncate"
								>
									{displayHandle}
								</a>
							) : (
								<span className="flex-1 text-3 text-gray-12 truncate">{displayHandle}</span>
							)}
							<button
								type="button"
								className={iconBtnCls}
								onClick={() => removeAt(i)}
								disabled={disabled}
								aria-label="Remove account"
							>
								<IconTrash />
							</button>
						</div>
					);
				})}
				<div className="flex flex-wrap items-center gap-2">
					{platforms.length === 0 ? (
						<input
							className={inputCls}
							value={platformId}
							onChange={(e) => setPlatformId(e.target.value)}
							placeholder="Platform UUID"
							disabled={disabled}
						/>
					) : (
						<select
							className={selectCls}
							value={platformId}
							onChange={(e) => setPlatformId(e.target.value)}
							disabled={disabled}
							aria-label="Platform"
						>
							{platforms.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
						</select>
					)}
					<input
						className={`${inputCls} flex-1 min-w-[140px]`}
						value={handle}
						onChange={(e) => setHandle(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								add();
							}
						}}
						placeholder="@handle"
						disabled={disabled}
					/>
					<button
						type="button"
						className={primaryBtnCls}
						onClick={add}
						disabled={disabled || !canAdd}
					>
						Add
					</button>
				</div>
				<details className="group/adv">
					<summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden text-2 text-gray-10 hover:text-gray-11 py-1 flex items-center gap-1">
						<IconChevron className="!h-3 !w-3 transition-transform duration-200 group-open/adv:rotate-90" />
						Advanced: custom profile URL
					</summary>
					<input
						className={`${inputCls} mt-1`}
						value={urlOverride}
						onChange={(e) => setUrlOverride(e.target.value)}
						placeholder="https://… (leave blank to auto-derive)"
						disabled={disabled}
					/>
				</details>
			</div>
		</SectionDisclosure>
	);
}

function ContactCard({
	d,
	platforms,
	update,
	commit,
	onDelete,
	disabled,
}: {
	d: FollowingDraft;
	platforms: PlatformOption[];
	update: (next: FollowingDraft) => void;
	commit: (next: FollowingDraft) => void;
	onDelete: () => void;
	disabled?: boolean;
}) {
	return (
		<details className="group/card border border-gray-a4 rounded-lg bg-gray-a2 overflow-hidden">
			<summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-gray-a3/40">
				<IconChevron className="transition-transform duration-200 group-open/card:rotate-90 text-gray-10" />
				<div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
					<span className="text-4 font-semibold text-gray-12 truncate">
						{d.name.trim() || "Unnamed"}
					</span>
					<CollapsedBrandStack accounts={d.accounts} platforms={platforms} />
				</div>
				<button
					type="button"
					className={iconBtnCls}
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						onDelete();
					}}
					disabled={disabled}
					aria-label={`Delete ${d.name || "contact"}`}
				>
					<IconTrash />
				</button>
			</summary>

			<div className="px-4 pb-4 border-t border-gray-a4 flex flex-col gap-2">
				<div className="pt-3">
					<label className="text-2 text-gray-10 block mb-1">Name</label>
					<input
						className={inputCls}
						value={d.name}
						onChange={(e) => update({ ...d, name: e.target.value })}
						onBlur={() => commit(d)}
						placeholder="Full name"
						disabled={disabled}
					/>
				</div>

				<div className="pt-1">
					<BirthdaySelect
						value={d.birthday || null}
						onSave={(serialized) => commit({ ...d, birthday: serialized ?? "" })}
						disabled={disabled}
					/>
				</div>

				<PhonesSection d={d} commit={commit} disabled={disabled} />
				<EmailsSection d={d} commit={commit} disabled={disabled} />
				<AddressesSection d={d} update={update} commit={commit} disabled={disabled} />
				<NotesSection d={d} update={update} commit={commit} disabled={disabled} />
				<SocialAccountsSection d={d} commit={commit} platforms={platforms} disabled={disabled} />
			</div>
		</details>
	);
}

function NewContactCard({
	draft,
	setDraft,
	onCreate,
	onCancel,
	disabled,
}: {
	draft: FollowingDraft;
	setDraft: (d: FollowingDraft) => void;
	onCreate: () => void;
	onCancel: () => void;
	disabled?: boolean;
}) {
	const canCreate = draft.name.trim().length > 0;
	return (
		<div className="border border-gray-a4 rounded-lg bg-gray-a2 p-4 flex flex-col gap-3">
			<div>
				<label className="text-2 text-gray-10 block mb-1">Name</label>
				<input
					className={inputCls}
					value={draft.name}
					onChange={(e) => setDraft({ ...draft, name: e.target.value })}
					placeholder="Full name"
					autoFocus
					disabled={disabled}
				/>
			</div>
			<div className="flex gap-2 justify-end">
				<button type="button" className={secondaryBtnCls} onClick={onCancel} disabled={disabled}>
					Cancel
				</button>
				<button
					type="button"
					className={primaryBtnCls}
					onClick={onCreate}
					disabled={disabled || !canCreate}
				>
					Create contact
				</button>
			</div>
		</div>
	);
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
	const [drafts, setDrafts] = useState<FollowingDraft[]>(() => initialList.map(followingToDraft));
	const [newDraft, setNewDraft] = useState<FollowingDraft>(() => emptyDraft("new"));
	const [isAdding, setIsAdding] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	const syncKey = useMemo(
		() => initialList.map((f) => `${f.id}:${f.updated_at}`).join("|"),
		[initialList],
	);

	useEffect(() => {
		setDrafts(initialList.map(followingToDraft));
	}, [syncKey, initialList]);

	const updateLocal = useCallback((next: FollowingDraft) => {
		setDrafts((prev) => prev.map((d) => (d.id === next.id ? next : d)));
	}, []);

	const commit = useCallback(
		(next: FollowingDraft) => {
			setError(null);
			setDrafts((prev) => prev.map((d) => (d.id === next.id ? next : d)));
			startTransition(() => {
				void (async () => {
					try {
						await experienceUpdateFollowing(experienceId, next.id, draftToUpdate(next));
						router.refresh();
					} catch (e) {
						setError(e instanceof Error ? e.message : "Save failed");
					}
				})();
			});
		},
		[experienceId, router],
	);

	const handleDelete = (id: string, name: string) => {
		if (!confirm(`Remove ${name || "this contact"} from Following?`)) return;
		setError(null);
		startTransition(() => {
			void (async () => {
				try {
					await experienceDeleteFollowing(experienceId, id);
					router.refresh();
				} catch (e) {
					setError(e instanceof Error ? e.message : "Delete failed");
				}
			})();
		});
	};

	const handleCreate = () => {
		if (!newDraft.name.trim()) {
			setError("Enter a name to add someone.");
			return;
		}
		setError(null);
		startTransition(() => {
			void (async () => {
				try {
					await experienceCreateFollowing(experienceId, draftToInsert(newDraft));
					setNewDraft(emptyDraft("new"));
					setIsAdding(false);
					router.refresh();
				} catch (e) {
					setError(e instanceof Error ? e.message : "Create failed");
				}
			})();
		});
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-3">
				<h2 className="text-5 font-bold text-gray-12">Following:</h2>
				<div className="ml-auto">
					<button
						type="button"
						className={secondaryBtnCls}
						onClick={() => setIsAdding((v) => !v)}
						disabled={pending}
					>
						{isAdding ? "Close" : "Add New"}
					</button>
				</div>
			</div>

			{error ? (
				<div className="text-3 text-red-11 border border-red-a6 rounded-md px-3 py-2 bg-red-a2" role="alert">
					{error}
				</div>
			) : null}

			{isAdding ? (
				<NewContactCard
					draft={newDraft}
					setDraft={setNewDraft}
					onCreate={handleCreate}
					onCancel={() => {
						setNewDraft(emptyDraft("new"));
						setIsAdding(false);
					}}
					disabled={pending}
				/>
			) : null}

			{drafts.length === 0 && !isAdding ? (
				<p className="text-3 text-gray-10 border border-dashed border-gray-a4 rounded-lg p-8 text-center bg-gray-a2/50">
					No contacts yet. Click <strong className="text-gray-11">Add New</strong> to create one, or sync from the{" "}
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
						<ContactCard
							key={d.id}
							d={d}
							platforms={platforms}
							update={updateLocal}
							commit={commit}
							onDelete={() => handleDelete(d.id, d.name)}
							disabled={pending}
						/>
					))}
				</div>
			)}
		</div>
	);
}
