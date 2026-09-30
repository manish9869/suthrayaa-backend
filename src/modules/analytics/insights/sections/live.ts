import { supabaseAdmin } from "../../../../config/supabase.js";
import { getSettingsMap } from "../../../settings/settings.service.js";
import { groupKeys } from "../../../settings/settings.catalog.js";
import { isCollected, loadInventory, localDay, paymentAttempts, zonedMidnight } from "../../analytics.service.js";
import { ga4Configured, runRealtime, type GaReport } from "../../ga4/client.js";
import { eventIn, rowSum } from "../ga.js";
import { kpi, pct, round2, shares, type Block, type Row } from "../types.js";
import { fmtPct, money, safeDiv, titleCase, type SectionDef } from "./common.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (v: unknown) => Number(v ?? 0);

// ---------------------------------------------------------------- Real-time

export const realtime: SectionDef = {
  id: "realtime",
  title: "Real-time",
  uses: { store: false, ga: true },
  refresh: 30,
  async build(ctx) {
    const tz = ctx.period.tz;
    const since = zonedMidnight(localDay(new Date(), tz), tz).toISOString();
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { data: today } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, total, payment_status, payment_method, status, placed_at, shipping_address")
      .not("placed_at", "is", null)
      .gte("placed_at", since)
      .order("placed_at", { ascending: false })
      .limit(200);
    const orders = (today ?? []).filter((o: any) => o.placed_at);

    let rt: GaReport[] | null = null;
    let error: string | null = null;
    if (ga4Configured()) {
      try {
        rt = await Promise.all([
          runRealtime({ metrics: ["activeUsers", "screenPageViews", "eventCount"] }),
          runRealtime({ dimensions: ["minutesAgo"], metrics: ["activeUsers"], limit: 30 }),
          runRealtime({ dimensions: ["deviceCategory"], metrics: ["activeUsers"] }),
          runRealtime({ dimensions: ["country"], metrics: ["activeUsers"], limit: 10 }),
          runRealtime({ dimensions: ["unifiedScreenName"], metrics: ["activeUsers", "screenPageViews"], limit: 15 }),
          runRealtime({ dimensions: ["eventName"], metrics: ["eventCount"], dimensionFilter: eventIn(["view_item", "add_to_cart", "begin_checkout", "purchase", "search", "add_to_wishlist"]) }),
        ]);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    const minutes = Array.from({ length: 30 }, (_, i) => 29 - i).map((m) => {
      const row = rt?.[1].rows.find((r) => Number(r.minutesAgo) === m);
      return { key: String(m), label: m === 0 ? "now" : `${m} min ago`, values: { activeUsers: rt ? num(row?.activeUsers) : null } };
    });
    const ev = (name: string) => (rt ? rowSum(rt[5], "eventName", name, "eventCount") : null);
    const blocks: Block[] = [];
    if (!ga4Configured()) blocks.push({ type: "notice", id: "ga", tone: "info", text: "Connect Google Analytics to see who's on the shop right now. Today's orders below are live from your shop." });
    else if (error) blocks.push({ type: "notice", id: "ga", tone: "warning", text: `Live visitor numbers couldn't be loaded: ${error}` });
    blocks.push(
      {
        type: "kpis",
        id: "now",
        title: "Right now",
        items: [
          kpi("active", "Visitors (last 30 min)", rt ? num(rt[0].totals.activeUsers) : null, null, "number", "ga4"),
          kpi("views", "Page views (30 min)", rt ? num(rt[0].totals.screenPageViews) : null, null, "number", "ga4"),
          kpi("carts", "Added to cart (30 min)", ev("add_to_cart"), null, "number", "ga4"),
          kpi("checkouts", "Started checkout (30 min)", ev("begin_checkout"), null, "number", "ga4"),
          kpi("ordersHour", "Orders in the last hour", orders.filter((o: any) => o.placed_at >= hourAgo).length, null, "number", "store"),
          kpi("ordersToday", "Orders today", orders.length, null, "number", "store"),
          kpi("revenueToday", "Revenue today", round2(orders.filter(isCollected).reduce((s: number, o: any) => s + num(o.total), 0)), null, "money", "store", { hint: "Paid so far today (COD counts once delivered)" }),
        ],
      },
      { type: "series", id: "minutes", title: "Visitors per minute", metrics: [{ key: "activeUsers", label: "Visitors", format: "number", source: "ga4" }], points: minutes, chart: "bar" },
      { type: "breakdown", id: "devices", title: "On which device", format: "number", source: "ga4", items: shares((rt?.[2].rows ?? []).map((r) => ({ label: titleCase(String(r.deviceCategory)), value: num(r.activeUsers) }))) },
      { type: "breakdown", id: "countries", title: "From where", format: "number", source: "ga4", items: shares((rt?.[3].rows ?? []).map((r) => ({ label: String(r.country), value: num(r.activeUsers) }))) },
      {
        type: "table",
        id: "pages",
        title: "Pages being viewed",
        source: "ga4",
        columns: [
          { key: "page", label: "Page" },
          { key: "users", label: "Visitors", format: "number", align: "right" },
          { key: "views", label: "Views", format: "number", align: "right" },
        ],
        rows: (rt?.[4].rows ?? []).map((r) => ({ page: String(r.unifiedScreenName), users: num(r.activeUsers), views: num(r.screenPageViews) })),
        empty: ga4Configured() ? "Nobody on the shop right now." : "Needs Google Analytics.",
      },
      {
        type: "table",
        id: "orders",
        title: "Today's orders",
        source: "store",
        columns: [
          { key: "time", label: "Time" },
          { key: "order", label: "Order" },
          { key: "city", label: "City" },
          { key: "payment", label: "Payment" },
          { key: "total", label: "Total", format: "money", align: "right" },
        ],
        rows: orders.slice(0, 25).map((o: any) => ({
          time: new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(o.placed_at)),
          order: o.order_number,
          city: o.shipping_address?.city ?? "",
          payment: o.payment_method === "cod" ? "Cash on delivery" : titleCase(o.payment_status),
          total: num(o.total),
        })),
        empty: "No orders yet today.",
      }
    );
    return blocks;
  },
};

// ---------------------------------------------------------------- Alerts

export interface AlertCheck {
  status: "alert" | "ok" | "unknown";
  area: string;
  check: string;
  detail: string;
}

export const alerts: SectionDef = {
  id: "alerts",
  title: "Alerts",
  uses: { store: true, ga: true },
  async build(ctx) {
    const { period: p } = ctx;
    const t = await getSettingsMap(groupKeys("insights"));
    const th = (k: string, d: number) => {
      const v = Number(t[`insights.${k}`]);
      return Number.isFinite(v) && v > 0 ? v : d;
    };
    const [store, ga, attempts, inventory, lastOrder] = await Promise.all([
      ctx.store(),
      ctx.ga.pair([
        { dimensions: ["eventName"], metrics: ["sessions", "eventCount", "eventValue"], dimensionFilter: eventIn(["session_start", "begin_checkout", "purchase", "LCP", "exception"]) },
      ]),
      paymentAttempts({ since: p.since, until: p.until }),
      loadInventory(),
      supabaseAdmin.from("orders").select("placed_at").not("placed_at", "is", null).order("placed_at", { ascending: false }).limit(1),
    ]);
    const checks: AlertCheck[] = [];
    const add = (status: AlertCheck["status"], area: string, check: string, detail: string) => checks.push({ status, area, check, detail });
    const s = store.cur.totals;
    const ps = store.prev?.totals;

    const drop = (cur: number, prev: number | undefined) => (prev ? ((prev - cur) / prev) * 100 : null);
    const revDrop = drop(s.gross, ps?.gross);
    const limRev = th("alert_revenue_drop_pct", 25);
    if (revDrop === null) add("unknown", "Sales", `Revenue drop over ${limRev}%`, "Nothing to compare with.");
    else add(revDrop >= limRev ? "alert" : "ok", "Sales", `Revenue drop over ${limRev}%`, `${money(s.gross)} vs ${money(ps!.gross)} (${revDrop >= 0 ? "down" : "up"} ${fmtPct(Math.abs(revDrop))})`);

    const ordDrop = drop(s.orders, ps?.orders);
    const limOrd = th("alert_orders_drop_pct", 25);
    if (ordDrop === null) add("unknown", "Sales", `Orders drop over ${limOrd}%`, "Nothing to compare with.");
    else add(ordDrop >= limOrd ? "alert" : "ok", "Sales", `Orders drop over ${limOrd}%`, `${s.orders} vs ${ps!.orders} orders`);

    const hours = th("alert_no_orders_hours", 48);
    const last = lastOrder.data?.[0]?.placed_at as string | undefined;
    const since = last ? (Date.now() - Date.parse(last)) / 3600_000 : null;
    add(since === null || since >= hours ? "alert" : "ok", "Sales", `No orders for ${hours} hours`, since === null ? "No orders yet." : `Last order ${since < 1 ? "less than an hour" : `${Math.floor(since)} hours`} ago`);

    const refundRate = pct(s.refunds, s.gross);
    const limRef = th("alert_refund_rate_pct", 10);
    add(refundRate !== null && refundRate > limRef ? "alert" : refundRate === null ? "unknown" : "ok", "Refunds", `Refund rate above ${limRef}%`, refundRate === null ? "No revenue in this period." : `${fmtPct(refundRate)} of revenue refunded`);

    const failed = attempts.byStatus.find((x) => x.status === "failed")?.count ?? 0;
    const online = attempts.byStatus.reduce((a, x) => a + x.count, 0);
    const failRate = pct(failed, online);
    const limFail = th("alert_payment_failure_pct", 30);
    add(failRate !== null && failRate > limFail && failed >= 3 ? "alert" : failRate === null ? "unknown" : "ok", "Checkout", `Failed payments above ${limFail}%`, failRate === null ? "No payment attempts." : `${failed} of ${online} payment attempts failed (${fmtPct(failRate)})`);

    const low = inventory.alerts;
    add(low.length ? "alert" : "ok", "Inventory", "Products low or out of stock", low.length ? `${low.length}: ${low.slice(0, 4).map((x: any) => `${x.name} (${x.stock})`).join(", ")}${low.length > 4 ? "…" : ""}` : "Stock is fine.");

    if (ga) {
      const r = ga.cur[0];
      const sess = (n: string) => rowSum(r, "eventName", n, "sessions") ?? 0;
      const conv = safeDiv(sess("purchase"), sess("session_start"), 100);
      const prevConv = ga.prev ? safeDiv(rowSum(ga.prev[0], "eventName", "purchase", "sessions"), rowSum(ga.prev[0], "eventName", "session_start", "sessions"), 100) : null;
      const limConv = th("alert_conversion_drop_pct", 25);
      const convDrop = conv !== null && prevConv ? ((prevConv - conv) / prevConv) * 100 : null;
      add(convDrop === null ? "unknown" : convDrop >= limConv ? "alert" : "ok", "Conversion", `Conversion rate drop over ${limConv}%`, conv === null ? "No visits." : `${fmtPct(conv)}${prevConv !== null ? ` vs ${fmtPct(prevConv)}` : ""}`);

      const limAb = th("alert_checkout_abandon_pct", 80);
      const began = sess("begin_checkout");
      const abandon = began >= 5 ? 100 - (sess("purchase") / began) * 100 : null;
      add(abandon === null ? "unknown" : abandon > limAb ? "alert" : "ok", "Checkout", `Checkout abandonment above ${limAb}%`, abandon === null ? "Fewer than 5 checkouts started." : `${fmtPct(abandon)} of ${began} checkouts not finished`);

      const lcpRow = r.rows.find((x) => x.eventName === "LCP");
      const lcp = lcpRow && num(lcpRow.eventCount) ? num(lcpRow.eventValue) / num(lcpRow.eventCount) : null;
      const limLcp = th("alert_lcp_ms", 4000);
      add(lcp === null ? "unknown" : lcp > limLcp ? "alert" : "ok", "Site speed", `Pages slower than ${limLcp} ms`, lcp === null ? "No speed data yet." : `Pages show their main content in ${Math.round(lcp)} ms on average`);

      const errs = rowSum(r, "eventName", "exception", "eventCount") ?? 0;
      const limErr = th("alert_page_errors", 20);
      add(errs > limErr ? "alert" : "ok", "Site health", `More than ${limErr} page errors`, `${errs} errors reported by visitors`);
    } else {
      add("unknown", "Google Analytics", "Visitor alerts (conversion, checkout, speed, errors)", ctx.ga.configured ? `GA4 unavailable: ${ctx.ga.error}` : "Connect Google Analytics to turn these on.");
    }

    const active = checks.filter((c) => c.status === "alert");
    const rows: Row[] = checks.map((c) => ({ status: c.status === "alert" ? "Alert" : c.status === "ok" ? "OK" : "—", area: c.area, check: c.check, detail: c.detail }));
    return [
      {
        type: "insights",
        id: "active",
        title: active.length ? `${active.length} ${active.length === 1 ? "thing needs" : "things need"} attention` : "All clear",
        items: active.length ? active.map((c) => ({ tone: "bad" as const, text: `${c.check} — ${c.detail}` })) : [{ tone: "good", text: "Every check is within its limit for this period." }],
      },
      {
        type: "table",
        id: "checks",
        title: "All checks",
        description: "Change the limits under “Alert limits” below.",
        source: "mixed",
        columns: [
          { key: "status", label: "Status" },
          { key: "area", label: "Area" },
          { key: "check", label: "Check" },
          { key: "detail", label: "Now" },
        ],
        rows: rows.sort((a, b) => (a.status === "Alert" ? -1 : 0) - (b.status === "Alert" ? -1 : 0)),
      },
    ];
  },
};

/** How many alerts are active — for the badge on the Insights menu. */
export const countAlerts = (blocks: Block[]) => {
  const table = blocks.find((b) => b.type === "table" && b.id === "checks");
  return table && table.type === "table" ? table.rows.filter((r) => r.status === "Alert").length : 0;
};
