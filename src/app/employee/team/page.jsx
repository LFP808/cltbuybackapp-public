import { PageTitle, Card } from "@/components/ui";
import { TeamManager } from "@/components/employee/team/TeamManager";
import { listTeamMembers } from "@/lib/repositories/profiles";
import { getCurrentStaff } from "@/lib/auth";

/**
 * Team management: who can sign in, and what each of them can see.
 */
export default async function TeamPage() {
  const staff = await getCurrentStaff();

  let members = [];
  let dbError = null;
  try {
    members = await listTeamMembers();
  } catch (err) {
    dbError = err?.message || "Could not load the team.";
  }

  const isAdmin = staff.role === "admin";

  return (
    <div>
      <div className="mb-5">
        <PageTitle>Team</PageTitle>
        <p className="mt-1 text-[13.5px] text-muted">
          {isAdmin
            ? "Add staff, and set what each of them can see."
            : "Who's on the team. Ask an admin to add someone or change a role."}
        </p>
      </div>

      {dbError ? (
        <Card className="text-[13.5px] text-muted">
          <p className="mb-2 font-semibold text-ink">Could not load the team.</p>
          <p>{dbError}</p>
        </Card>
      ) : (
        <TeamManager members={members} isAdmin={isAdmin} currentUserId={staff.id} />
      )}
    </div>
  );
}
