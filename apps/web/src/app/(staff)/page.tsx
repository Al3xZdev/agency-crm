import { redirect } from 'next/navigation';

/** Staff home: dashboard (deferred from PR3 to PR5). */
export default function StaffHome() {
  redirect('/dashboard');
}
