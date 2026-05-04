"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
	cloneTemplateViaApi,
	createBlankTemplateViaApi,
	deleteTemplateViaApi,
	type TemplateActionsConfig,
} from "./gallery-actions";
import { type GalleryTemplate, ShotstackTemplateGallery } from "./template-gallery";

/**
 * Thin wrapper around `<ShotstackTemplateGallery />` that binds the
 * fetch-based handlers for a given surface (Whop / GHL). Server pages pass
 * in the `templatesApiBase` + `templatesApiQuery` and an `editorUrlPrefix`
 * and the wrapper wires up clone / delete / create-blank from there.
 */
export function ShotstackTemplateGalleryClient({
	templates,
	actions,
	editorUrlPrefix,
	allowCreate,
}: {
	templates: GalleryTemplate[];
	actions: TemplateActionsConfig;
	/** Prefix used when navigating to the editor (no trailing slash). */
	editorUrlPrefix: string;
	/** When true, render a "New template" tile that creates a blank via POST. */
	allowCreate?: boolean;
}) {
	const router = useRouter();
	const editorHrefFor = useCallback(
		(id: string) => {
			const base = `${editorUrlPrefix}/${id}`;
			if (!actions.templatesApiQuery) return base;
			return `${base}?${actions.templatesApiQuery}`;
		},
		[actions.templatesApiQuery, editorUrlPrefix],
	);
	const onClone = useCallback((id: string) => cloneTemplateViaApi(actions, id), [actions]);
	const onDelete = useCallback(
		async (id: string) => {
			await deleteTemplateViaApi(actions, id);
			router.refresh();
		},
		[actions, router],
	);
	const onCreateBlank = useCallback(() => createBlankTemplateViaApi(actions), [actions]);
	return (
		<ShotstackTemplateGallery
			templates={templates}
			editorHrefFor={editorHrefFor}
			onClone={onClone}
			onDelete={onDelete}
			onCreateBlank={allowCreate ? onCreateBlank : undefined}
		/>
	);
}
