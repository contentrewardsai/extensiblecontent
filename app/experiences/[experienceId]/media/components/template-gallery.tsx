"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

export interface GalleryTemplate {
	id: string;
	name: string;
	default_env: string | null;
	is_builtin: boolean;
	source_path: string | null;
	thumbnail_url: string | null;
	thumbnail_updated_at: string | null;
	updated_at: string | null;
	user_id: string | null;
}

type Filter = "all" | "mine" | "starters";

function displayThumbnailUrl(t: GalleryTemplate): string | null {
	if (!t.thumbnail_url) return null;
	const bust = t.thumbnail_updated_at || t.updated_at || "";
	if (!bust) return t.thumbnail_url;
	const sep = t.thumbnail_url.includes("?") ? "&" : "?";
	return `${t.thumbnail_url}${sep}v=${encodeURIComponent(bust)}`;
}

function formatRelative(iso: string | null): string {
	if (!iso) return "—";
	try {
		const d = new Date(iso);
		return d.toLocaleString();
	} catch {
		return iso;
	}
}

/**
 * A shared, self-contained gallery for ShotStack templates used by both the
 * Whop experience page and the GHL `/ext/media` page.
 *
 * The component is surface-agnostic: the hosting page passes in URL builders,
 * a clone handler, and a delete handler so the same grid / preview card
 * behaves correctly on either surface without knowing about experience ids or
 * GHL location/company ids directly.
 */
export function ShotstackTemplateGallery({
	templates,
	editorHrefFor,
	onClone,
	onDelete,
	onCreateBlank,
}: {
	templates: GalleryTemplate[];
	/** URL to open in the visual editor for a given template id. */
	editorHrefFor: (id: string) => string;
	/** Async clone of a built-in or user-owned template → returns new template id. Throws on failure. */
	onClone: (id: string) => Promise<{ id: string }>;
	/** Async delete of a user-owned template. Called only for non-built-ins. */
	onDelete?: (id: string) => Promise<void>;
	/** If set, renders a "New from scratch" tile that calls this handler. */
	onCreateBlank?: () => Promise<{ id: string }>;
}) {
	const [filter, setFilter] = useState<Filter>("all");
	const [selected, setSelected] = useState<GalleryTemplate | null>(null);
	const [actionState, setActionState] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const filtered = useMemo(() => {
		if (filter === "mine") return templates.filter((t) => !t.is_builtin);
		if (filter === "starters") return templates.filter((t) => t.is_builtin);
		return templates;
	}, [filter, templates]);

	const userCount = templates.filter((t) => !t.is_builtin).length;
	const builtinCount = templates.filter((t) => t.is_builtin).length;

	const handleOpen = (t: GalleryTemplate) => {
		setActionState(null);
		setSelected(t);
	};

	const handleCloseModal = () => {
		if (isPending) return;
		setSelected(null);
		setActionState(null);
	};

	const handleClone = (t: GalleryTemplate) => {
		startTransition(async () => {
			setActionState("Cloning…");
			try {
				const res = await onClone(t.id);
				window.location.href = editorHrefFor(res.id);
			} catch (e) {
				setActionState(e instanceof Error ? e.message : "Clone failed.");
			}
		});
	};

	const handleCreateBlank = () => {
		if (!onCreateBlank) return;
		startTransition(async () => {
			setActionState("Creating…");
			try {
				const res = await onCreateBlank();
				window.location.href = editorHrefFor(res.id);
			} catch (e) {
				setActionState(e instanceof Error ? e.message : "Could not create template.");
			}
		});
	};

	const handleDelete = (t: GalleryTemplate) => {
		if (!onDelete) return;
		if (!window.confirm(`Delete "${t.name}"? This can't be undone.`)) return;
		startTransition(async () => {
			setActionState("Deleting…");
			try {
				await onDelete(t.id);
				setSelected(null);
			} catch (e) {
				setActionState(e instanceof Error ? e.message : "Delete failed.");
			}
		});
	};

	return (
		<div className="flex flex-col gap-4">
			{actionState && !selected ? (
				<p className="text-3 text-red-11 border border-red-a6 rounded-md px-3 py-2 bg-red-a2">{actionState}</p>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<div className="inline-flex items-center gap-1 border border-gray-a4 rounded-md p-0.5 bg-gray-a1">
					<TabButton active={filter === "all"} onClick={() => setFilter("all")}>
						All <span className="text-2 text-gray-10">({templates.length})</span>
					</TabButton>
					<TabButton active={filter === "mine"} onClick={() => setFilter("mine")}>
						My templates <span className="text-2 text-gray-10">({userCount})</span>
					</TabButton>
					<TabButton active={filter === "starters"} onClick={() => setFilter("starters")}>
						Starters <span className="text-2 text-gray-10">({builtinCount})</span>
					</TabButton>
				</div>
			</div>

			<ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
				{onCreateBlank ? (
					<li>
						<button
							type="button"
							onClick={handleCreateBlank}
							disabled={isPending}
							className="group w-full flex flex-col items-center justify-center aspect-video border border-dashed border-gray-a5 rounded-lg bg-gray-a1 hover:border-gray-a8 hover:bg-gray-a2 text-gray-11 hover:text-gray-12 disabled:opacity-60"
						>
							<span className="text-5 font-light leading-none">+</span>
							<span className="text-3 mt-2">New template</span>
							<span className="text-2 text-gray-10 mt-1">From scratch</span>
						</button>
					</li>
				) : null}
				{filtered.map((t) => (
					<li key={t.id}>
						<button
							type="button"
							onClick={() => handleOpen(t)}
							className="group w-full text-left block border border-gray-a4 rounded-lg overflow-hidden bg-gray-a1 hover:border-gray-a7 focus:outline-none focus:ring-2 focus:ring-gray-a7"
						>
							<TemplateThumbnail template={t} />
							<div className="p-3">
								<div className="flex items-start gap-2">
									<p className="text-3 font-medium text-gray-12 truncate min-w-0 flex-1">{t.name}</p>
									{t.is_builtin ? (
										<span className="shrink-0 text-2 px-1.5 py-0.5 rounded bg-gray-a4 text-gray-11">Starter</span>
									) : null}
								</div>
								<p className="text-2 text-gray-10 mt-1 truncate">
									{t.default_env === "stage" ? "Staging" : "Production"} · {formatRelative(t.updated_at)}
								</p>
							</div>
						</button>
					</li>
				))}
			</ul>

			{filtered.length === 0 && !onCreateBlank ? (
				<div className="border border-gray-a4 rounded-lg p-6 bg-gray-a2 text-3 text-gray-10">
					No templates in this view.
				</div>
			) : null}

			{selected ? (
				<PreviewModal
					template={selected}
					onClose={handleCloseModal}
					onEdit={() => {
						window.location.href = editorHrefFor(selected.id);
					}}
					onClone={() => handleClone(selected)}
					onDelete={onDelete ? () => handleDelete(selected) : undefined}
					busy={isPending}
					status={actionState}
					editorHrefFor={editorHrefFor}
				/>
			) : null}
		</div>
	);
}

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`text-3 px-3 py-1 rounded ${
				active ? "bg-gray-12 text-gray-1" : "text-gray-12 hover:bg-gray-a3"
			}`}
		>
			{children}
		</button>
	);
}

function TemplateThumbnail({ template }: { template: GalleryTemplate }) {
	const url = displayThumbnailUrl(template);
	return (
		<div className="relative w-full aspect-video bg-gradient-to-br from-gray-a3 via-gray-a2 to-gray-a4">
			{url ? (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={url}
					alt=""
					className="absolute inset-0 w-full h-full object-cover"
					loading="lazy"
					decoding="async"
				/>
			) : (
				<div className="absolute inset-0 flex items-center justify-center text-gray-10 text-2 px-3 text-center">
					{template.is_builtin ? "Starter template" : "No thumbnail yet — open to capture one on save"}
				</div>
			)}
		</div>
	);
}

function PreviewModal({
	template,
	onClose,
	onEdit,
	onClone,
	onDelete,
	busy,
	status,
	editorHrefFor,
}: {
	template: GalleryTemplate;
	onClose: () => void;
	onEdit: () => void;
	onClone: () => void;
	onDelete?: () => void;
	busy: boolean;
	status: string | null;
	editorHrefFor: (id: string) => string;
}) {
	const url = displayThumbnailUrl(template);
	return (
		<div
			role="dialog"
			aria-modal
			className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
			onClick={onClose}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				className="flex flex-col w-full max-w-2xl bg-gray-1 border border-gray-a5 rounded-xl shadow-2xl overflow-hidden"
			>
				<div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-a4">
					<div className="flex items-center gap-2 min-w-0">
						<p className="text-4 font-semibold text-gray-12 truncate">{template.name}</p>
						{template.is_builtin ? (
							<span className="shrink-0 text-2 px-1.5 py-0.5 rounded bg-gray-a4 text-gray-11">Starter</span>
						) : null}
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="text-4 text-gray-11 hover:text-gray-12 px-2 leading-none"
					>
						×
					</button>
				</div>
				<div className="relative w-full aspect-video bg-gray-a2">
					{url ? (
						// eslint-disable-next-line @next/next/no-img-element
						<img src={url} alt="" className="absolute inset-0 w-full h-full object-contain" />
					) : (
						<div className="absolute inset-0 flex items-center justify-center text-3 text-gray-10 px-6 text-center">
							{template.is_builtin
								? "This starter has no thumbnail yet. Clone it to your account and the editor will capture one on save."
								: "No thumbnail yet — the editor captures one automatically the first time you save."}
						</div>
					)}
				</div>
				<div className="flex flex-col gap-1 px-4 py-3 border-t border-gray-a4">
					<p className="text-2 text-gray-10">
						{template.default_env === "stage" ? "Staging" : "Production"} · Updated{" "}
						{formatRelative(template.updated_at)}
						{template.source_path ? <> · from {template.source_path}</> : null}
					</p>
					{status ? <p className="text-2 text-gray-11">{status}</p> : null}
				</div>
				<div className="flex flex-wrap items-center gap-2 justify-end px-4 py-3 border-t border-gray-a4 bg-gray-a2">
					{onDelete && !template.is_builtin ? (
						<button
							type="button"
							onClick={onDelete}
							disabled={busy}
							className="text-3 px-3 py-1.5 rounded-md border border-red-a6 text-red-11 hover:bg-red-a2 disabled:opacity-50"
						>
							Delete
						</button>
					) : null}
					<div className="flex-1" />
					{template.is_builtin ? (
						<>
							<Link
								href={editorHrefFor(template.id)}
								className="text-3 px-3 py-1.5 rounded-md border border-gray-a5 text-gray-12 hover:bg-gray-a3"
							>
								Open read-only
							</Link>
							<button
								type="button"
								onClick={onClone}
								disabled={busy}
								className="text-3 px-4 py-1.5 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 disabled:opacity-50"
							>
								Clone & edit
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={onEdit}
							disabled={busy}
							className="text-3 px-4 py-1.5 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 disabled:opacity-50"
						>
							Edit (visual)
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
