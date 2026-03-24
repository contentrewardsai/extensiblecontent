import { redirect } from "next/navigation";

export default async function ExperienceIndexPage({ params }: { params: Promise<{ experienceId: string }> }) {
	const { experienceId } = await params;
	redirect(`/experiences/${experienceId}/activity`);
}
