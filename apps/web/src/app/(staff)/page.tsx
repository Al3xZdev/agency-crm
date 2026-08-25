import { redirect } from 'next/navigation';

/** Staff home: straight to the working surface for now. */
export default function StaffHome() {
  redirect('/clients');
}
