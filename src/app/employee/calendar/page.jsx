import { PageTitle, Card } from "@/components/ui";
import { CalendarViews } from "@/components/employee/CalendarViews";
import { listPickups, listCalendarOrders, listOrders } from "@/lib/repositories/orders";
import { cashFloat } from "@/domain/float";

/**
 * The calendar: a month grid of every booked meetup, with week and day views
 * for the planning and the counter shapes of the same question.
 */
export default async function CalendarPage() {
  let calendarOrders = [];
  let float = null;
  let dbError = null;
  try {
    // listPickups is today's open meetups — the float's idea of "today's run".
    const [orders, todaysMeetups] = await Promise.all([listCalendarOrders(), listPickups()]);
    calendarOrders = orders;

    // How much cash today's meetups need. `.catch`ed on its own, because a
    // calendar that will not render is a worse outcome than one without a
    // float estimate.
    const history = await listOrders().catch(() => []);
    float = cashFloat({ stops: todaysMeetups, history });
  } catch (err) {
    dbError = err?.message || "Could not load the calendar.";
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <PageTitle>Calendar</PageTitle>
        <p className="mt-1 text-[13.5px] text-muted">Booked meetups, by day.</p>
      </div>

      {dbError ? (
        <Card className="text-[13.5px] text-muted">
          <p className="mb-2 font-semibold text-ink">Could not load the calendar.</p>
          <p>{dbError}</p>
        </Card>
      ) : (
        <CalendarViews calendarOrders={calendarOrders} float={float} />
      )}
    </div>
  );
}
