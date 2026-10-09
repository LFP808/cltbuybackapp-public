import {
  Users,
  Repeat,
  DollarSign,
  Package,
  PackageOpen,
  TrendingUp,
  Clock,
  MessageSquareWarning,
} from "lucide-react";
import { Card } from "@/components/ui";
import { currency } from "@/domain/format";
import { STAGES } from "@/domain/constants";
import { cn } from "@/lib/cn";

const STATUS_FILL = {
  awaiting: "bg-status-awaiting",
  received: "bg-status-received",
  paid: "bg-status-paid",
};
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

/**
 * Admin overview. Order-derived figures reflect the selected date range
 * (metrics.rangeLabel); the "now" row and the alert tiles are point-in-time.
 * Sections listed in `hidden` are omitted (configured via the settings gear).
 */
export function OverviewPanel({ metrics: m, hidden = [] }) {
  const hide = new Set(hidden);
  const show = (key) => !hide.has(key);

  return (
    <div className="space-y-5">
      {/* Period KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Leads"
          value={m.newLeads}
          sub={`new · ${m.rangeLabel}`}
          subTone="up"
        />
        <StatCard
          icon={Repeat}
          label="Repeat customers"
          value={m.repeatCustomers}
          sub={`${pct(m.repeatRate)} repeat rate`}
        />
        <StatCard
          icon={DollarSign}
          label="Paid out"
          value={currency(m.paidTotal)}
          sub={`${m.paidCount} payout${m.paidCount === 1 ? "" : "s"}`}
          subTone="up"
        />
        {/* The big number is live orders; the rate divides by everything
            taken, cancelled included (see computeDashboardMetrics). The
            cancelled count beside the rate is what makes those reconcile. */}
        <StatCard
          icon={Package}
          label="Orders"
          value={m.ordersInPeriod}
          sub={`${pct(m.conversionRate)} reached payout${
            m.cancelledInPeriod > 0 ? ` · ${m.cancelledInPeriod} cancelled` : ""
          }`}
        />
      </div>

      {/* Secondary — avg payout (period) + current-state alerts */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat icon={DollarSign} label="Avg payout" value={currency(m.avgPayout)} />
        <MiniStat icon={PackageOpen} label="Open orders · now" value={m.current.openOrders} />
        <MiniStat
          icon={MessageSquareWarning}
          label="Waiting on reply · now"
          value={m.current.waitingReplies}
          alert={m.current.waitingReplies > 0}
        />
        <MiniStat
          icon={Clock}
          label="Follow-ups · now"
          value={m.current.followUps}
          alert={m.current.followUps > 0}
        />
      </div>

      {/* Pipeline + trend */}
      {(show("pipeline") || show("trend")) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {show("pipeline") && (
            <Card>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-[14px] font-bold text-ink">Order pipeline</h3>
                <span className="text-[12px] text-muted">{pct(m.conversionRate)} reach payout</span>
              </div>
              <div className="mt-3 space-y-2.5">
                {STAGES.map((stage) => (
                  <FunnelRow
                    key={stage.key}
                    stage={stage.key}
                    count={m.statusCounts[stage.key] || 0}
                    max={Math.max(1, ...Object.values(m.statusCounts))}
                  />
                ))}
              </div>
            </Card>
          )}

          {show("trend") && (
            <Card>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-[14px] font-bold text-ink">Orders per {m.trend.unit}</h3>
                <span className="inline-flex items-center gap-1 text-[12px] capitalize text-muted">
                  <TrendingUp size={13} className="text-cash" /> {m.rangeLabel}
                </span>
              </div>
              <TrendBars buckets={m.trend.buckets} />
            </Card>
          )}
        </div>
      )}

      {/* Top customers + methods + mix */}
      {(show("top") || show("methods") || show("mix")) && (
        <div className="grid gap-4 lg:grid-cols-3">
          {show("top") && (
            <Card>
              <h3 className="mb-3 text-[14px] font-bold text-ink">Top customers</h3>
              <div className="space-y-2.5">
                {m.topCustomers.map((c, i) => (
                  <div key={c.phone} className="flex items-center gap-3">
                    <span className="w-4 text-[12px] font-bold text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ink">{c.name}</div>
                      <div className="text-[11px] text-muted">
                        {c.orders} order{c.orders === 1 ? "" : "s"}
                      </div>
                    </div>
                    {/* Cash green: this is money that actually went out the
                        door to a customer, not chrome. */}
                    <span className="font-serif text-[13.5px] text-cash">
                      {currency(c.totalPaid)}
                    </span>
                  </div>
                ))}
                {m.topCustomers.length === 0 && <Empty>No orders in this range.</Empty>}
              </div>
            </Card>
          )}

          {show("methods") && (
            <Card>
              <h3 className="mb-3 text-[14px] font-bold text-ink">Payout by method</h3>
              <div className="space-y-3">
                {m.paymentMethods.map((pm) => (
                  <div key={pm.method}>
                    <div className="mb-1 flex items-center justify-between text-[12.5px]">
                      <span className="font-medium text-ink">{pm.method}</span>
                      <span className="text-muted">
                        {currency(pm.amount)} · {pm.count}
                      </span>
                    </div>
                    <Bar
                      value={pm.amount}
                      max={Math.max(1, ...m.paymentMethods.map((x) => x.amount))}
                    />
                  </div>
                ))}
                {m.paymentMethods.length === 0 && <Empty>No payouts in this range.</Empty>}
              </div>
            </Card>
          )}

          {show("mix") && (
            <Card>
              <h3 className="mb-3 text-[14px] font-bold text-ink">Meetups vs walk-ins</h3>
              <div className="space-y-3">
                <SplitStat
                  a={{ label: "Meetups", value: m.orderTypeSplit.meetups }}
                  b={{ label: "Walk-ins", value: m.orderTypeSplit.walkIns }}
                />
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <MiniStat label="Orders in range" value={m.ordersInPeriod} />
                  <MiniStat label="All customers" value={m.current.totalCustomers} />
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- pieces ---------------- */

function StatCard({ icon: Icon, label, value, sub, subTone }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {label}
        </span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-l text-accent">
          <Icon size={14} />
        </span>
      </div>
      <div className="font-serif text-[26px] leading-none tracking-tight text-ink">
        {value}
      </div>
      {sub && (
        <div
          className={cn(
            "mt-1.5 text-[12px] capitalize",
            subTone === "up" ? "text-cash" : "text-muted",
          )}
        >
          {sub}
        </div>
      )}
    </Card>
  );
}

function MiniStat({ icon: Icon, label, value, alert }) {
  return (
    <Card className={cn("p-3.5", alert && "border-status-awaiting/40 bg-status-awaiting-bg/40")}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {Icon && <Icon size={12} className={alert ? "text-status-awaiting" : "text-muted"} />}
        {label}
      </div>
      <div className={cn("mt-1 text-[19px] font-bold text-ink", alert && "text-status-awaiting")}>
        {value}
      </div>
    </Card>
  );
}

function FunnelRow({ stage, count, max }) {
  const width = Math.max(4, (count / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[12.5px] font-medium text-ink">{STAGE_LABEL[stage]}</span>
      <div className="h-5 flex-1 overflow-hidden rounded-md bg-bg">
        <div
          className={cn("h-full rounded-md", STATUS_FILL[stage])}
          style={{ width: `${width}%` }}
          title={`${STAGE_LABEL[stage]}: ${count}`}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-[13px] font-bold tabular-nums text-ink">
        {count}
      </span>
    </div>
  );
}

function TrendBars({ buckets }) {
  const max = Math.max(1, ...buckets.map((d) => d.count));
  const step = buckets.length > 8 ? 2 : 1;
  return (
    <div className="mt-4">
      <div className="relative flex h-32 items-end gap-2">
        {buckets.map((d) => {
          const h = Math.max(3, (d.count / max) * 88);
          return (
            <div key={d.start} className="relative h-full flex-1">
              <div
                className="absolute inset-x-0 bottom-0 rounded-t bg-accent transition-all"
                style={{ height: `${h}%` }}
                title={`${d.label}: ${d.count} orders${d.paid ? `, ${currency(d.paid)} paid` : ""}`}
              />
              <span
                className="absolute inset-x-0 text-center text-[10px] font-semibold tabular-nums text-muted"
                style={{ bottom: `calc(${h}% + 3px)` }}
              >
                {d.count}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2">
        {buckets.map((d, i) => (
          <span key={d.start} className="flex-1 text-center text-[9.5px] text-muted/80">
            {i % step === 0 ? d.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function Bar({ value, max }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-bg">
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${Math.max(3, (value / max) * 100)}%` }}
      />
    </div>
  );
}

function SplitStat({ a, b }) {
  const total = Math.max(1, a.value + b.value);
  return (
    <div>
      <div className="mb-1 flex justify-between text-[12.5px]">
        <span className="font-medium text-ink">
          {a.label} <span className="text-muted">· {a.value}</span>
        </span>
        <span className="font-medium text-ink">
          <span className="text-muted">{b.value} ·</span> {b.label}
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-bg">
        <div className="h-full bg-accent" style={{ width: `${(a.value / total) * 100}%` }} />
        <div className="h-full bg-accent/40" style={{ width: `${(b.value / total) * 100}%` }} />
      </div>
    </div>
  );
}

function Empty({ children }) {
  return <p className="text-[12.5px] italic text-muted">{children}</p>;
}

function pct(x) {
  return `${Math.round((x || 0) * 100)}%`;
}
