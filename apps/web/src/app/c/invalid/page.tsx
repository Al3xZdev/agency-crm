import Link from 'next/link';

export const metadata = { title: 'Invalid link' };

/**
 * The SINGLE generic failure page (task 4.4): unknown, expired and revoked
 * links all land here — deliberately indistinguishable.
 */
export default function InvalidLinkPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">This link is not valid</h1>
        <p className="mt-2 text-sm text-neutral-500">
          It may have expired or been revoked. Ask your account contact for a new one.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium text-neutral-900 underline underline-offset-4"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
