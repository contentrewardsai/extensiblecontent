/**
 * Documentation types for nested workflow JSON stored in `workflows.workflow` (jsonb).
 * The extension API does not use these for runtime validation today; routes assign the
 * client payload as-is. See docs/BACKEND_IMPLEMENTATION_PROMPT.md.
 *
 * Future validation (e.g. Zod): keep the stored document forward-compatible.
 * - Prefer `z.record(z.unknown())` or object schemas with `.passthrough()` for any
 *   object that may carry unknown keys (workflow root, `analyzed`, each `action`,
 *   `comment`, each `items[]` element).
 * - If you validate `comment.items[]`, allow `type` in `text | video | audio` and
 *   optional `id`, `text`, `url`, and still passthrough other properties on each item.
 *
 * Example sketch (not executed; add `zod` if you wire this in):
 *
 * ```ts
 * const workflowCommentItemSchema = z
 *   .object({
 *     type: z.enum(["text", "video", "audio"]),
 *     id: z.string().optional(),
 *     text: z.string().optional(),
 *     url: z.string().optional(),
 *   })
 *   .passthrough();
 * ```
 */

export type WorkflowCommentItemType = "text" | "video" | "audio";

/** Known fields for rich comment steps; clients may add more — servers must not strip them. */
export interface WorkflowCommentItem {
	type: WorkflowCommentItemType;
	id?: string;
	text?: string;
	url?: string;
}
