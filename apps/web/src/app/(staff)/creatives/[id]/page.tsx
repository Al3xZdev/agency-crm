import { CreativeDetailView } from './CreativeDetailView';

export default async function CreativeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CreativeDetailView creativeId={id} />;
}
