import { UploadView } from './UploadView';

export default async function UploadPage({ params }: { params: Promise<{ creativeId: string }> }) {
  const { creativeId } = await params;
  return <UploadView creativeId={creativeId} />;
}
