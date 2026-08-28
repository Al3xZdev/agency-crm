import { CampaignDetailView } from './CampaignDetailView';

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignDetailView campaignId={id} />;
}
