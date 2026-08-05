import { redirect } from 'next/navigation';

// NuraView CRM: single-purpose app. Home is the Leads view.
// (The generic NuraviewCRM dashboard is left in git history if anyone needs it.)
export default function Home() {
  redirect('/leads');
}
