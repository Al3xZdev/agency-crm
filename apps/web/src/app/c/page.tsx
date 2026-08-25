export const metadata = { title: 'Client access' };

/**
 * Landing surface for an active CLIENT session (task 4.4). Real approval
 * content arrives with later slices; this slice only proves the session.
 */
export default function ClientHomePage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">You are signed in</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Your client workspace is ready. Pending approvals will appear here.
        </p>
      </div>
    </main>
  );
}
