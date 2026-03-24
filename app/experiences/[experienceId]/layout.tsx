import Link from "next/link";
import { requireExperienceContext } from "@/lib/experience-context";
import { ExperienceNav } from "./experience-nav";

export default async function ExperienceLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ experienceId: string }>;
}) {
	const { experienceId } = await params;
	const ctx = await requireExperienceContext(experienceId);

	return (
		<div className="flex flex-col p-6 md:p-8 gap-2 max-w-6xl mx-auto">
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<p className="text-3 text-gray-10 mb-1">{ctx.experienceName}</p>
					<h1 className="text-8 font-semibold text-gray-12">Hi, {ctx.displayName}</h1>
					<p className="text-3 text-gray-10 mt-2 max-w-xl">
						Extension data for your account: sidebars, following, workflow uploads, templates, ShotStack, and Upload Post.
					</p>
				</div>
				<Link
					href="https://github.com/contentrewardsai/ExtensibleContentExtension"
					target="_blank"
					rel="noopener noreferrer"
					className="text-3 text-gray-11 hover:text-gray-12 underline shrink-0"
				>
					Chrome extension
				</Link>
			</div>
			<ExperienceNav experienceId={experienceId} />
			{children}
		</div>
	);
}
