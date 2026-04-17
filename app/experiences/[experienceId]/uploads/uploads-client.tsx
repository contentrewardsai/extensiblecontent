"use client";

import { useRouter } from "next/navigation";
import {
	type FormEvent,
	useId,
	useMemo,
	useRef,
	useState,
	useTransition,
} from "react";
import {
	deletePostMediaAction,
	getStorageUploadUrlAction,
	revalidateUploadsAction,
} from "../experience-actions";
import {
	formatBytes,
	POST_MEDIA_FOLDERS,
	type PostMediaFile,
	type PostMediaFolder,
	type ProjectFolderGroup,
	resolvePostMediaFolder,
} from "@/lib/storage-post-media";

export interface UploadProjectOption {
	id: string;
	name: string;
	role: "owner" | "editor" | "viewer";
}

interface UploadsClientProps {
	experienceId: string;
	projects: UploadProjectOption[];
	defaultProjectId: string | null;
	groups: ProjectFolderGroup[];
}

interface UploadStatus {
	kind: "idle" | "working" | "success" | "error";
	message?: string;
	filename?: string;
}

const FOLDER_LABELS: Record<PostMediaFolder | "other", string> = {
	photos: "Photos",
	videos: "Videos",
	documents: "Documents",
	other: "Other",
};

export function UploadsClient({ experienceId, projects, defaultProjectId, groups }: UploadsClientProps) {
	return (
		<div className="flex flex-col gap-8">
			<UploadForm experienceId={experienceId} projects={projects} defaultProjectId={defaultProjectId} />
			<ProjectFolders experienceId={experienceId} groups={groups} />
		</div>
	);
}

function UploadForm({
	experienceId,
	projects,
	defaultProjectId,
}: {
	experienceId: string;
	projects: UploadProjectOption[];
	defaultProjectId: string | null;
}) {
	const router = useRouter();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
	const [mediaType, setMediaType] = useState<PostMediaFolder | "auto">("auto");
	const [isPrivate, setIsPrivate] = useState(false);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [status, setStatus] = useState<UploadStatus>({ kind: "idle" });
	const formId = useId();

	const detectedFolder = useMemo<PostMediaFolder | null>(() => {
		if (!selectedFile) return null;
		return resolvePostMediaFolder(selectedFile.type || null);
	}, [selectedFile]);

	const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const f = e.target.files?.[0] ?? null;
		setSelectedFile(f);
		setStatus({ kind: "idle" });
	};

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const file = fileInputRef.current?.files?.[0];
		if (!file) {
			setStatus({ kind: "error", message: "Choose a file first." });
			return;
		}
		setStatus({ kind: "working", filename: file.name, message: "Requesting upload URL…" });

		const fd = new FormData();
		fd.append("experienceId", experienceId);
		fd.append("filename", file.name);
		fd.append("content_type", file.type || "application/octet-stream");
		fd.append("size_bytes", String(file.size));
		if (projectId) fd.append("project_id", projectId);
		if (mediaType !== "auto") fd.append("media_type", mediaType);
		if (isPrivate) fd.append("private", "true");

		const result = await getStorageUploadUrlAction(fd);
		if (!result.ok) {
			setStatus({ kind: "error", message: result.error, filename: file.name });
			return;
		}

		setStatus({ kind: "working", filename: file.name, message: "Uploading to Supabase…" });
		try {
			const putRes = await fetch(result.upload_url, {
				method: "PUT",
				headers: { "Content-Type": file.type || "application/octet-stream" },
				body: file,
			});
			if (!putRes.ok) {
				const text = await putRes.text().catch(() => "");
				setStatus({
					kind: "error",
					filename: file.name,
					message: `Upload failed (${putRes.status})${text ? `: ${text.slice(0, 160)}` : ""}`,
				});
				return;
			}
		} catch (err) {
			setStatus({
				kind: "error",
				filename: file.name,
				message: err instanceof Error ? err.message : "Network error",
			});
			return;
		}

		setStatus({
			kind: "success",
			filename: file.name,
			message: `Uploaded to ${result.media_type}/ in project ${result.project_id_source === "default" ? "(default)" : ""}`.trim(),
		});
		setSelectedFile(null);
		if (fileInputRef.current) fileInputRef.current.value = "";

		await revalidateUploadsAction(experienceId);
		router.refresh();
	};

	const pending = status.kind === "working";

	return (
		<section className="border border-gray-a4 rounded-lg p-4 bg-gray-a2 flex flex-col gap-4">
			<div>
				<h3 className="text-5 font-semibold text-gray-12">Upload a file</h3>
				<p className="text-2 text-gray-10 mt-1">
					Files go straight to Supabase Storage at{" "}
					<code className="text-2 bg-gray-a3 px-1 rounded">{`{user}/{project}/posts/{folder}/{file}`}</code>, the
					same layout the extension uses. Public files are served from the <code className="text-2">post-media</code>{" "}
					bucket; private files use a 1-hour signed URL.
				</p>
			</div>

			<form id={formId} onSubmit={onSubmit} className="flex flex-col gap-3">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<label className="text-2 text-gray-11 flex flex-col gap-1">
						<span>File</span>
						<input
							ref={fileInputRef}
							type="file"
							onChange={onFileChange}
							required
							className="text-3 text-gray-12 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-gray-a4 file:text-gray-12 hover:file:bg-gray-a5"
						/>
						{selectedFile ? (
							<span className="text-2 text-gray-10">
								{formatBytes(selectedFile.size)} · {selectedFile.type || "unknown type"}
								{detectedFolder ? ` · auto: ${detectedFolder}` : ""}
							</span>
						) : null}
					</label>

					<label className="text-2 text-gray-11 flex flex-col gap-1">
						<span>Project</span>
						<select
							value={projectId}
							onChange={(e) => setProjectId(e.target.value)}
							className="text-3 text-gray-12 bg-gray-a2 border border-gray-a4 rounded-md px-2 py-1.5"
						>
							<option value="">Default (auto-select / create)</option>
							{projects.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
						</select>
					</label>

					<label className="text-2 text-gray-11 flex flex-col gap-1">
						<span>Folder</span>
						<select
							value={mediaType}
							onChange={(e) => setMediaType(e.target.value as PostMediaFolder | "auto")}
							className="text-3 text-gray-12 bg-gray-a2 border border-gray-a4 rounded-md px-2 py-1.5"
						>
							<option value="auto">Auto from file type</option>
							{POST_MEDIA_FOLDERS.map((f) => (
								<option key={f} value={f}>
									{FOLDER_LABELS[f]}
								</option>
							))}
						</select>
					</label>

					<label className="text-2 text-gray-11 flex flex-col gap-1">
						<span>Visibility</span>
						<label className="text-3 text-gray-12 flex items-center gap-2 mt-1">
							<input
								type="checkbox"
								checked={isPrivate}
								onChange={(e) => setIsPrivate(e.target.checked)}
								className="size-4"
							/>
							Private (1-hour signed URL)
						</label>
					</label>
				</div>

				<div className="flex items-center gap-3">
					<button
						type="submit"
						disabled={pending}
						className="text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 disabled:opacity-50 self-start"
					>
						{pending ? "Uploading…" : "Upload"}
					</button>
					{status.kind !== "idle" ? (
						<p
							className={`text-2 ${
								status.kind === "error"
									? "text-red-11"
									: status.kind === "success"
										? "text-green-11"
										: "text-gray-11"
							}`}
						>
							{status.filename ? <span className="font-mono mr-1">{status.filename}</span> : null}
							{status.message}
						</p>
					) : null}
				</div>
			</form>
		</section>
	);
}

function ProjectFolders({ experienceId, groups }: { experienceId: string; groups: ProjectFolderGroup[] }) {
	if (groups.length === 0) {
		return (
			<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-6 bg-gray-a2">
				No files yet. Upload a file above, or use the extension's <em>Upload to storage</em> step.
			</p>
		);
	}

	return (
		<section className="flex flex-col gap-4">
			<div>
				<h3 className="text-5 font-semibold text-gray-12">Project files</h3>
				<p className="text-2 text-gray-10 mt-1">
					Mirrors the extension's <code className="text-2">post-media</code> /{" "}
					<code className="text-2">post-media-private</code> buckets, grouped by project and media folder.
				</p>
			</div>
			<ul className="flex flex-col gap-3">
				{groups.map((g) => (
					<ProjectFolderCard key={g.projectId} experienceId={experienceId} group={g} />
				))}
			</ul>
		</section>
	);
}

function ProjectFolderCard({ experienceId, group }: { experienceId: string; group: ProjectFolderGroup }) {
	const [open, setOpen] = useState(group.totalFiles <= 24);
	const canModify = group.role === "owner" || group.role === "editor";
	const usagePct = group.quotaBytes && group.quotaBytes > 0 ? Math.min(100, (group.totalBytes / group.quotaBytes) * 100) : null;

	return (
		<li className="border border-gray-a4 rounded-lg bg-gray-a2 overflow-hidden">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-a3"
				aria-expanded={open}
			>
				<div className="flex flex-col gap-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-4 font-medium text-gray-12">{group.projectName}</span>
						{group.role && group.role !== "owner" ? (
							<span className="text-2 text-gray-11 px-1.5 py-0.5 rounded bg-gray-a4 capitalize">{group.role}</span>
						) : null}
					</div>
					<span className="text-2 text-gray-10 font-mono truncate">{group.projectId}</span>
					{group.projectId !== "_unsorted" ? (
						<a
							href={`/experiences/${experienceId}/projects/${group.projectId}`}
							className="text-2 text-gray-11 underline self-start mt-0.5"
							onClick={(e) => e.stopPropagation()}
						>
							Manage project →
						</a>
					) : null}
				</div>
				<div className="text-2 text-gray-11 text-right shrink-0 ml-3">
					<div>
						{group.totalFiles} file{group.totalFiles === 1 ? "" : "s"} · {formatBytes(group.totalBytes)}
					</div>
					{group.quotaBytes != null ? (
						<div className="text-gray-10 mt-1 w-32 inline-block">
							<div className="h-1.5 bg-gray-a3 rounded overflow-hidden">
								<div
									className="h-full bg-gray-10"
									style={{ width: `${usagePct ?? 0}%` }}
								/>
							</div>
							<div className="text-2 text-gray-10 mt-0.5">
								{formatBytes(group.totalBytes)} / {formatBytes(group.quotaBytes)}
							</div>
						</div>
					) : null}
					<div className="text-gray-10">{open ? "Hide" : "Show"}</div>
				</div>
			</button>
			{open ? (
				<div className="border-t border-gray-a4 flex flex-col gap-3 p-4">
					{group.folders.length === 0 ? (
						<p className="text-2 text-gray-10">No files in this project yet.</p>
					) : (
						group.folders.map((f) => (
							<FolderBlock
								key={f.folder}
								experienceId={experienceId}
								folder={f.folder}
								files={f.files}
								canModify={canModify}
							/>
						))
					)}
				</div>
			) : null}
		</li>
	);
}

function FolderBlock({
	experienceId,
	folder,
	files,
	canModify,
}: {
	experienceId: string;
	folder: PostMediaFolder | "other";
	files: PostMediaFile[];
	canModify: boolean;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="text-3 font-medium text-gray-12 flex items-center gap-2">
				<FolderIcon />
				<span>{FOLDER_LABELS[folder]}</span>
				<span className="text-2 text-gray-10">({files.length})</span>
			</div>
			<ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
				{files.map((f) => (
					<FileTile key={f.id} experienceId={experienceId} file={f} canModify={canModify} />
				))}
			</ul>
		</div>
	);
}

function FileTile({ experienceId, file, canModify }: { experienceId: string; file: PostMediaFile; canModify: boolean }) {
	const [pending, startTransition] = useTransition();
	const isImage = file.contentType?.startsWith("image/") || file.mediaFolder === "photos";
	const isVideo = file.contentType?.startsWith("video/") || file.mediaFolder === "videos";

	return (
		<li className="border border-gray-a4 rounded-md bg-gray-a1 p-2 flex flex-col gap-2">
			{file.url && isImage ? (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={file.url}
					alt={file.name}
					className="w-full h-32 object-cover rounded-sm bg-gray-a3"
					loading="lazy"
				/>
			) : file.url && isVideo ? (
				<video
					src={file.url}
					className="w-full h-32 object-cover rounded-sm bg-gray-a3"
					controls
					preload="metadata"
				/>
			) : (
				<div className="w-full h-32 rounded-sm bg-gray-a3 flex items-center justify-center text-2 text-gray-10">
					{file.contentType ?? "file"}
				</div>
			)}
			<div className="flex flex-col gap-0.5 min-w-0">
				<span className="text-2 text-gray-12 font-mono truncate" title={file.name}>
					{file.name}
				</span>
				<span className="text-2 text-gray-10">
					{formatBytes(file.sizeBytes)}
					{file.isPrivate ? " · private" : ""}
				</span>
			</div>
			<div className="flex items-center gap-2">
				{file.url ? (
					<a
						href={file.url}
						target="_blank"
						rel="noopener noreferrer"
						className="text-2 px-2 py-1 rounded-md border border-gray-a4 text-gray-12 hover:bg-gray-a3"
					>
						Open
					</a>
				) : (
					<span className="text-2 text-gray-10">No URL</span>
				)}
				{canModify ? (
					<form
						action={(formData) => {
							startTransition(async () => {
								await deletePostMediaAction(formData);
							});
						}}
						className="ml-auto"
					>
						<input type="hidden" name="experienceId" value={experienceId} />
						<input type="hidden" name="file_path" value={file.relativePath} />
						<input type="hidden" name="private" value={file.isPrivate ? "true" : "false"} />
						<button
							type="submit"
							disabled={pending}
							className="text-2 px-2 py-1 rounded-md border border-red-a5 text-red-11 hover:bg-red-a3 disabled:opacity-50"
						>
							{pending ? "…" : "Delete"}
						</button>
					</form>
				) : (
					<span className="ml-auto text-2 text-gray-10">View only</span>
				)}
			</div>
		</li>
	);
}

function FolderIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 20 20"
			fill="currentColor"
			className="size-4 text-gray-10"
			aria-hidden="true"
		>
			<path d="M3.75 4A1.75 1.75 0 0 0 2 5.75v8.5C2 15.216 2.784 16 3.75 16h12.5A1.75 1.75 0 0 0 18 14.25V7.75A1.75 1.75 0 0 0 16.25 6h-6.69l-1.2-1.6A1.75 1.75 0 0 0 6.96 4H3.75Z" />
		</svg>
	);
}
