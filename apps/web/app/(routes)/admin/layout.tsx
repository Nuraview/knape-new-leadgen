import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AdminSidebarNav } from "./_components/AdminSidebarNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/");

  return (
    <div className="flex h-full w-full min-h-0">
      <aside className="w-56 shrink-0 border-r bg-card flex flex-col py-4 px-2">
        <AdminSidebarNav />
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
