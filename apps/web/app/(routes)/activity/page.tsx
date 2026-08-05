import Container from "../components/ui/Container";
import { getSession } from "@/lib/auth-server";
import { getActivityStats } from "@/actions/dashboard/get-activity-stats";
import { ActivityBoards } from "./components/ActivityBoards";

// Always render fresh counts — this is a live scoreboard, not a cached page.
export const dynamic = "force-dynamic";

const ActivityDashboardPage = async () => {
  const session = await getSession();
  const stats = await getActivityStats(5);

  return (
    <Container
      title="Daily Activity"
      description="Your outreach scoreboard — calls made, emails sent, and projects viewed today."
    >
      <ActivityBoards
        today={stats.today}
        days={stats.days}
        name={session?.user?.name ?? undefined}
      />
    </Container>
  );
};

export default ActivityDashboardPage;
