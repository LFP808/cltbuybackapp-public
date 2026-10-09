import { PageTitle, Card } from "@/components/ui";
import { MessagesInbox } from "@/components/employee/messages/MessagesInbox";
import { listConversations } from "@/lib/repositories/conversations";
import { isMessagingEnabled } from "@/domain/mode";
import { getCurrentStaff } from "@/lib/auth";

/**
 * Messages inbox. `?phone=` optionally deep-links to a conversation (e.g. from
 * the Customers list).
 */
export default async function MessagesPage({ searchParams }) {
  const { phone } = await searchParams;
  const currentStaff = await getCurrentStaff();

  let conversations = [];
  let dbError = null;
  try {
    conversations = await listConversations();
  } catch (err) {
    dbError = err?.message || "Could not load conversations.";
  }

  return (
    <div>
      <PageTitle>Messages</PageTitle>
      {dbError ? (
        <Card className="text-[13.5px] text-muted">
          <p className="mb-2 font-semibold text-ink">Database not connected yet.</p>
          <p>Configure Supabase and run the migration to load conversations. ({dbError})</p>
        </Card>
      ) : (
        <MessagesInbox
          initialConversations={conversations}
          initialSelected={phone || null}
          messagingOff={!isMessagingEnabled()}
          currentStaff={{ id: currentStaff.id, name: currentStaff.name }}
        />
      )}
    </div>
  );
}
