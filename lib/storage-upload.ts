import { uploadToGhlMediaLibrary } from "@/lib/ghl-media-upload";
import { resolveStorageTarget, type ResolveStorageInput, type StorageTarget } from "@/lib/storage-destination";
import { POST_MEDIA_BUCKET_PRIVATE, POST_MEDIA_BUCKET_PUBLIC } from "@/lib/storage-post-media";
import { getServiceSupabase } from "@/lib/supabase-service";

const SIGNED_URL_EXPIRY = 3600;

export interface PerformUploadInput {
	resolve: ResolveStorageInput;
	/** Stable storage-path prefix inside the supabase bucket, e.g. `${owner}/generations/${templateId}`. */
	supabasePathPrefix: string;
	filename: string;
	contentType: string;
	bytes: ArrayBuffer;
	/** When true, use the private supabase bucket and return a signed URL. */
	privateSupabase?: boolean;
	/** Optional GHL Media Library folder id. */
	ghlParentId?: string | null;
}

export interface PerformUploadResult {
	fileUrl: string;
	storageType: "supabase" | "ghl";
	storageMeta: Record<string, unknown>;
	fallbackReason?: "no_ghl_connection" | "no_location" | "upload_failed";
	/**
	 * When fallbackReason === 'upload_failed', this carries the underlying
	 * exception message (e.g. "GHL media upload failed (401): Unauthorized") so
	 * the API caller can surface it to the user. Not stored separately on the
	 * row — `storageMeta.ghl_upload_error` already captures it.
	 */
	fallbackDetail?: string;
}

/**
 * Resolve the configured destination and perform the upload, auto-falling back
 * to Supabase when a GHL upload fails. Centralised so browser-render, thumbnail
 * upload, and future upload surfaces all behave identically.
 */
export async function performStorageUpload(input: PerformUploadInput): Promise<PerformUploadResult> {
	const target = await resolveStorageTarget(input.resolve);
	let fallbackReason: PerformUploadResult["fallbackReason"];
	if (target.type === "supabase" && target.fallbackReason) {
		fallbackReason = target.fallbackReason;
	}

	if (target.type === "ghl") {
		try {
			const out = await uploadToGhlMediaLibrary({
				internalUserId: input.resolve.internalUserId,
				locationId: target.locationId,
				filename: input.filename,
				contentType: input.contentType,
				bytes: input.bytes,
				parentId: input.ghlParentId ?? null,
			});
			return {
				fileUrl: out.url,
				storageType: "ghl",
				storageMeta: {
					ghl_location_id: target.locationId,
					ghl_company_id: target.companyId,
					ghl_media_id: out.mediaId,
				},
			};
		} catch (err) {
			// Auto-fall-back per product decision: don't block the render, but
			// mark the reason so the UI can surface "Saved to CRAI instead".
			const detail = err instanceof Error ? err.message : String(err);
			console.error("[storage] GHL upload failed, falling back to supabase:", err);
			fallbackReason = "upload_failed";
			const result = await uploadToSupabase(input, fallbackReason, {
				attempted_ghl_location_id: target.locationId,
				ghl_upload_error: detail,
			});
			return { ...result, fallbackDetail: detail };
		}
	}

	return uploadToSupabase(input, fallbackReason);
}

async function uploadToSupabase(
	input: PerformUploadInput,
	fallbackReason: PerformUploadResult["fallbackReason"],
	extraMeta: Record<string, unknown> = {},
): Promise<PerformUploadResult> {
	const supabase = getServiceSupabase();
	const bucket = input.privateSupabase ? POST_MEDIA_BUCKET_PRIVATE : POST_MEDIA_BUCKET_PUBLIC;
	const filePath = `${input.supabasePathPrefix}/${input.filename}`;

	const { error } = await supabase.storage.from(bucket).upload(filePath, input.bytes, {
		contentType: input.contentType,
		upsert: true,
	});
	if (error) throw new Error(error.message);

	let fileUrl: string;
	if (input.privateSupabase) {
		const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(filePath, SIGNED_URL_EXPIRY);
		fileUrl = signed?.signedUrl ?? "";
	} else {
		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
		fileUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
	}

	return {
		fileUrl,
		storageType: "supabase",
		storageMeta: {
			supabase_bucket: bucket,
			supabase_path: filePath,
			...extraMeta,
		},
		fallbackReason,
	};
}

/** Re-export for downstream consumers. */
export type { StorageTarget };
