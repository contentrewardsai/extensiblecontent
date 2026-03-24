import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "workflow-data";

export type ListedUploadObject = {
	path: string;
	name: string;
	updated_at: string | null;
};

/**
 * Depth-first listing under `{userId}/` in workflow-data (best-effort, capped).
 */
export async function listUserWorkflowUploads(
	supabase: SupabaseClient,
	userId: string,
	maxObjects = 400,
): Promise<ListedUploadObject[]> {
	const out: ListedUploadObject[] = [];
	const queue: string[] = [`${userId}`];

	while (queue.length > 0 && out.length < maxObjects) {
		const prefix = queue.shift()!;
		const { data: entries, error } = await supabase.storage.from(BUCKET).list(prefix, {
			limit: 100,
			offset: 0,
			sortBy: { column: "updated_at", order: "desc" },
		});

		if (error) {
			console.error("[storage-workflow-uploads] list failed:", prefix, error.message);
			continue;
		}

		for (const entry of entries ?? []) {
			const fullPath = `${prefix}/${entry.name}`;
			// Prefix "folders" have no file id in Storage list responses
			if (entry.id == null) {
				queue.push(fullPath);
				continue;
			}
			out.push({
				path: fullPath,
				name: entry.name,
				updated_at: entry.updated_at ?? null,
			});
			if (out.length >= maxObjects) break;
		}
	}

	return out;
}
