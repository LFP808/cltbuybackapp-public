import { PageTitle, Card, Badge } from "@/components/ui";
import { BookingHoursCard } from "@/components/employee/settings/BookingHoursCard";
import { NameListCard } from "@/components/employee/settings/NameListCard";
import { OfficeAddressCard } from "@/components/employee/settings/OfficeAddressCard";
import { AlertSoundCard } from "@/components/employee/settings/AlertSoundCard";
import { IncomingCallsCard } from "@/components/employee/settings/IncomingCallsCard";
import {
  getAdminSoundMuted,
  getIncomingCalls,
  getBookingSchedule,
  getGrades,
  getPaymentMethods,
  GRADES_KEY,
  PAYMENT_METHODS_KEY,
} from "@/lib/repositories/settings";
import { officeAddress } from "@/lib/business";
import { isSickwTestMode } from "@/lib/sickw/client";
import { isSmsTestMode } from "@/lib/twilio/client";
import { isMessagingEnabled } from "@/domain/mode";
import { menuPrompt, infoSpeech } from "@/domain/phone-menu";
import { dayKey } from "@/domain/dates";

/**
 * Settings: the knobs an admin can turn in the app (the meetup location,
 * booking hours, grades, payment methods, the alert chime, what an incoming
 * call hears), then the integrations status.
 * Integrations are configured through environment variables on the server,
 * so those cards just report their live mode.
 */
export default async function SettingsPage() {
  const [office, bookingSchedule, grades, paymentMethods, soundMuted, incomingCalls] =
    await Promise.all([
      officeAddress(),
      getBookingSchedule(),
      getGrades(),
      getPaymentMethods(),
      getAdminSoundMuted(),
      getIncomingCalls(),
    ]);
  const sickwTest = isSickwTestMode();
  const smsTest = isSmsTestMode();
  const messagingOff = !isMessagingEnabled();

  return (
    <div className="max-w-2xl">
      <PageTitle>Settings</PageTitle>

      <div className="space-y-3">
        {/* First: it is the one setting a customer reads. `source` tells the
            card whether these values are the admin's or the server's env. */}
        <OfficeAddressCard
          address={{
            street: office.street,
            street2: office.street2,
            city: office.city,
            state: office.state,
            zip: office.zip,
          }}
          source={office.source}
        />

        <BookingHoursCard schedule={bookingSchedule} />

        <NameListCard
          title="Grades / conditions"
          settingKey={GRADES_KEY}
          names={grades}
          description="One ladder, two moments: the condition the VA picks per item when booking a meetup, and the grade check-in and the device editor record. The first entry is what a check-in row starts on when the booking stated nothing."
          helper="Staff can ADD a condition from the booking form; renaming, reordering and removing happen only here. Removing or renaming one never changes orders or devices already carrying it - it is plain text, kept exactly as recorded."
        />

        <NameListCard
          title="Payment methods"
          settingKey={PAYMENT_METHODS_KEY}
          names={paymentMethods}
          description="What the payout pickers offer - walk-ins, meetup payouts."
          helper='Keep "Cash" spelled exactly that way if you use it - the cash-float math recognizes payouts by that word.'
        />

        <AlertSoundCard muted={soundMuted} />

        {/* The menu script comes from the same functions the webhooks call,
            so the card cannot show words a caller wouldn't hear. */}
        <IncomingCallsCard
          mode={incomingCalls.mode}
          message={incomingCalls.message}
          menuGreeting={menuPrompt(office.name)}
          menuInfo={infoSpeech({
            address: office,
            schedule: bookingSchedule,
            today: dayKey(new Date()),
          })}
        />

        <Card className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-bold text-ink">Sickw (IMEI lookups)</div>
            <div className="text-[12.5px] text-muted">
              Configured via SICKW_API_KEY. Test mode answers from canned fixtures.
            </div>
          </div>
          <Badge className={sickwTest ? "" : "bg-status-received-bg text-status-received"}>
            {sickwTest ? "Test mode" : "Live"}
          </Badge>
        </Card>

        <Card className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-bold text-ink">Twilio (customer texts)</div>
            <div className="text-[12.5px] text-muted">
              {messagingOff
                ? "Switched off at MESSAGING_ENABLED - nothing sent, nothing recorded."
                : "Configured via TWILIO_* + SMS_TEST_MODE."}
            </div>
          </div>
          {/* Three states, not two. "Test mode" and "Off" look alike from the
              outside and are not: one fills the threads with messages nobody
              received, the other leaves them empty. */}
          <Badge
            className={
              messagingOff
                ? "bg-status-awaiting-bg text-status-awaiting"
                : smsTest
                  ? ""
                  : "bg-status-received-bg text-status-received"
            }
          >
            {messagingOff ? "Off" : smsTest ? "Test mode (logged only)" : "Live"}
          </Badge>
        </Card>

        <Card className="text-[13px] leading-relaxed text-muted">
          <p className="mb-1 font-semibold text-ink">Where to change these</p>
          Set the values in your hosting provider&apos;s environment variables (see{" "}
          <code>.env.example</code>). Real texts require <code>MESSAGING_ENABLED=true</code> and{" "}
          <code>SMS_TEST_MODE=false</code> plus Twilio credentials; live IMEI lookups require{" "}
          <code>SICKW_API_KEY</code>.
        </Card>
      </div>
    </div>
  );
}
