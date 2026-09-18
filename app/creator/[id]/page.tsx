import VideoHub from "@/components/VideoHub";

export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VideoHub creatorId={id} />;
}
