import { dimIs, eventIn, gaBucketDim, gaSeries, rowSum, total } from "../ga.js";
import { storeSeries } from "../store.js";
import { kpi, pct, type Block } from "../types.js";
import { compareLabel, fmtPct, gaNotice, mergeSeries, money, safeDiv, seriesBlock, zipSeries, type SectionDef } from "./common.js";

/**
 * Executive overview: headline KPIs (store money + GA4 behaviour), revenue / orders / users
 * over time with the comparison period, and plain-language insights.
 */
export const overview: SectionDef = {
  id: "overview",
  title: "Overview",
  uses: { store: true, ga: true },
  async build(ctx) {
    const { period: p } = ctx;
    const bucket = gaBucketDim(p.granularity);
    const [store, ga] = await Promise.all([
      ctx.store(),
      ctx.ga.pair([
        { metrics: ["activeUsers", "newUsers", "sessions"] },
        { dimensions: ["eventName"], metrics: ["sessions", "eventCount"], dimensionFilter: eventIn(["add_to_cart", "begin_checkout", "purchase", "add_to_wishlist"]) },
        { dimensions: [bucket], metrics: ["activeUsers", "newUsers", "sessions"], limit: 400 },
        { dimensions: [bucket], metrics: ["activeUsers"], dimensionFilter: dimIs("newVsReturning", "returning"), limit: 400 },
        { dimensions: ["deviceCategory", "eventName"], metrics: ["sessions"], dimensionFilter: eventIn(["session_start", "purchase"]) },
        { dimensions: ["sessionDefaultChannelGroup"], metrics: ["sessions"], limit: 10 },
      ]),
    ]);

    const s = store.cur.totals;
    const ps = store.prev?.totals ?? null;
    const g = (i: number, m: string) => total(ga?.cur[i], m);
    const gp = (i: number, m: string) => (ga?.prev ? total(ga.prev[i], m) : null);
    const ev = (r: typeof ga, which: "cur" | "prev", name: string, m: string) => (r && r[which] ? rowSum(r[which]![1], "eventName", name, m) : null);

    const users = g(0, "activeUsers");
    const pUsers = gp(0, "activeUsers");
    const sessions = g(0, "sessions");
    const pSessions = gp(0, "sessions");
    const conv = (w: "cur" | "prev", sess: number | null) => safeDiv(ev(ga, w, "purchase", "sessions"), sess, 100);
    const atc = (w: "cur" | "prev", sess: number | null) => safeDiv(ev(ga, w, "add_to_cart", "sessions"), sess, 100);
    const checkoutConv = (w: "cur" | "prev") => safeDiv(ev(ga, w, "purchase", "sessions"), ev(ga, w, "begin_checkout", "sessions"), 100);

    const kpis: Block = {
      type: "kpis",
      id: "kpis",
      items: [
        kpi("revenue", "Total revenue", s.gross, ps?.gross ?? null, "money", "store", { hint: "Money collected for orders placed in the period (online once paid, COD once delivered)" }),
        kpi("netRevenue", "Net revenue", s.net, ps?.net ?? null, "money", "store", { hint: "Total revenue minus refunds on those orders" }),
        kpi("orders", "Orders", s.orders, ps?.orders ?? null, "number", "store"),
        kpi("itemsSold", "Items sold", s.units, ps?.units ?? null, "number", "store"),
        kpi("users", "Users", users, pUsers, "number", "ga4", { hint: "People who visited (Google Analytics)" }),
        kpi("sessions", "Sessions", sessions, pSessions, "number", "ga4"),
        kpi("newCustomers", "New customers", s.newCustomers, ps?.newCustomers ?? null, "number", "store", { hint: "First-ever order in this period" }),
        kpi("returningCustomers", "Returning customers", s.returningCustomers, ps?.returningCustomers ?? null, "number", "store", { hint: "Had ordered before this period" }),
        kpi("aov", "Average order value", s.aov, ps?.aov ?? null, "money", "store"),
        kpi("revenuePerUser", "Revenue per user", safeDiv(s.gross, users), ps && pUsers !== null ? safeDiv(ps.gross, pUsers) : null, "money", "mixed", { hint: "Store revenue ÷ Google Analytics users" }),
        kpi("conversion", "Ecommerce conversion rate", conv("cur", sessions), conv("prev", pSessions), "percent", "ga4", { hint: "Sessions with a purchase ÷ all sessions" }),
        kpi("addToCartRate", "Add-to-cart rate", atc("cur", sessions), atc("prev", pSessions), "percent", "ga4", { hint: "Sessions with an add to cart ÷ all sessions" }),
        kpi("checkoutConversion", "Checkout conversion rate", checkoutConv("cur"), checkoutConv("prev"), "percent", "ga4", { hint: "Sessions that purchased ÷ sessions that began checkout" }),
        kpi("refunds", "Refund amount", s.refunds, ps?.refunds ?? null, "money", "store", { goodWhenUp: false, hint: "Refunded on orders placed in the period" }),
        kpi("refundRate", "Refund rate", pct(s.refunds, s.gross), ps ? pct(ps.refunds, ps.gross) : null, "percent", "store", { goodWhenUp: false }),
        kpi("wishlistAdds", "Wishlist adds", ev(ga, "cur", "add_to_wishlist", "eventCount"), ev(ga, "prev", "add_to_wishlist", "eventCount"), "number", "ga4"),
      ],
    };

    // ---- charts
    const sCur = storeSeries(store.cur, p.granularity, p.tz).map((x) => ({ key: x.key, label: x.label, values: { revenue: x.gross, netRevenue: x.revenue, orders: x.orders } }));
    const sPrev = store.prev ? storeSeries(store.prev, p.granularity, p.tz).map((x) => ({ key: x.key, label: x.label, values: { revenue: x.gross, netRevenue: x.revenue, orders: x.orders } })) : null;
    const usersSeries = (i: "cur" | "prev", from: string, to: string) => {
      const r = ga?.[i];
      const base = gaSeries(r?.[2], from, to, p.granularity, ["activeUsers", "newUsers", "sessions"]);
      const ret = gaSeries(r?.[3], from, to, p.granularity, ["activeUsers"]);
      return base.map((b, j) => ({ ...b, values: { users: b.values.activeUsers, newUsers: b.values.newUsers, returningUsers: ret[j]?.values.activeUsers ?? null, sessions: b.values.sessions } }));
    };
    const uCur = usersSeries("cur", p.from, p.to);
    const uPrev = ga?.prev && p.compareFrom && p.compareTo ? usersSeries("prev", p.compareFrom, p.compareTo) : null;

    const blocks: Block[] = [
      ...gaNotice(ctx),
      kpis,
      seriesBlock("revenue", "Revenue", [{ key: "revenue", label: "Revenue", format: "money", source: "store" }, { key: "netRevenue", label: "Net revenue", format: "money", source: "store" }], mergeSeries(sCur, sPrev)),
      seriesBlock("orders", "Orders", [{ key: "orders", label: "Orders", format: "number", source: "store" }], mergeSeries(sCur, sPrev), { chart: "bar" }),
      seriesBlock(
        "users",
        "Users",
        [
          { key: "users", label: "Users", format: "number", source: "ga4" },
          { key: "newUsers", label: "New users", format: "number", source: "ga4" },
          { key: "returningUsers", label: "Returning users", format: "number", source: "ga4" },
          { key: "sessions", label: "Sessions", format: "number", source: "ga4" },
        ],
        mergeSeries(uCur, uPrev)
      ),
      seriesBlock(
        "revenueVsOrders",
        "Revenue vs orders",
        [
          { key: "revenue", label: "Revenue", format: "money", source: "store" },
          { key: "orders", label: "Orders", format: "number", source: "store" },
          { key: "users", label: "Users", format: "number", source: "ga4" },
        ],
        mergeSeries(zipSeries(sCur, uCur), sPrev && uPrev ? zipSeries(sPrev, uPrev) : sPrev),
        { description: "Pick any two to compare on the same chart." }
      ),
    ];

    // ---- plain-language insights
    const items: { tone: "good" | "bad" | "neutral"; text: string }[] = [];
    const vs = compareLabel(p);
    const moved = (label: string, cur: number | null, prev: number | null | undefined, fmt: (n: number) => string, goodUp = true, min = 5) => {
      if (cur === null || prev === null || prev === undefined) return;
      if (!prev) {
        if (cur > 0) items.push({ tone: goodUp ? "good" : "bad", text: `${label} ${fmt(cur)} — none in ${vs || "the previous period"}.` });
        return;
      }
      const c = ((cur - prev) / prev) * 100;
      if (Math.abs(c) < min) return;
      const up = c > 0;
      items.push({ tone: up === goodUp ? "good" : "bad", text: `${label} ${up ? "rose" : "fell"} ${Math.abs(Math.round(c))}% compared with ${vs || "the previous period"} (${fmt(cur)} vs ${fmt(prev)}).` });
    };
    if (ps) {
      moved("Revenue", s.gross, ps.gross, money);
      moved("Orders", s.orders, ps.orders, String);
      moved("Average order value", s.aov, ps.aov, money);
      moved("Refunds", s.refunds, ps.refunds, money, false, 10);
    }
    const cr = conv("cur", sessions);
    const pcr = conv("prev", pSessions);
    if (cr !== null && pcr !== null && Math.abs(cr - pcr) >= 0.2) items.push({ tone: cr > pcr ? "good" : "bad", text: `Conversion rate ${cr > pcr ? "improved" : "dropped"} from ${fmtPct(pcr)} to ${fmtPct(cr)}.` });

    const dev = ga?.cur[4];
    if (dev && dev.rows.length) {
      const visits = (d: string) => dev.rows.filter((r) => r.deviceCategory === d && r.eventName === "session_start").reduce((a, r) => a + Number(r.sessions), 0);
      const buys = (d: string) => dev.rows.filter((r) => r.deviceCategory === d && r.eventName === "purchase").reduce((a, r) => a + Number(r.sessions), 0);
      const allVisits = ["mobile", "desktop", "tablet"].reduce((a, d) => a + visits(d), 0);
      const allBuys = ["mobile", "desktop", "tablet"].reduce((a, d) => a + buys(d), 0);
      const mv = pct(visits("mobile"), allVisits);
      const mb = pct(buys("mobile"), allBuys);
      if (mv !== null) {
        if (mb !== null && allBuys >= 5 && mv - mb >= 10) items.push({ tone: "bad", text: `Mobile brings ${fmtPct(mv)} of visits but only ${fmtPct(mb)} of purchases — the mobile checkout may need attention.` });
        else items.push({ tone: "neutral", text: `Mobile traffic is ${fmtPct(mv)} of all visits${mb !== null && allBuys ? ` and ${fmtPct(mb)} of purchases` : ""}.` });
      }
    }
    const ch = ga?.cur[5];
    if (ch && ch.rows.length) {
      const top = [...ch.rows].sort((a, b) => Number(b.sessions) - Number(a.sessions))[0];
      const share = pct(Number(top.sessions), total(ch, "sessions") ?? 0);
      if (share !== null) items.push({ tone: "neutral", text: `Most visits came from ${top.sessionDefaultChannelGroup} (${fmtPct(share)}).` });
    }
    const began = ev(ga, "cur", "begin_checkout", "sessions");
    const bought = ev(ga, "cur", "purchase", "sessions");
    if (began && began >= 5 && bought !== null) {
      const abandon = 100 - (bought / began) * 100;
      if (abandon >= 50) items.push({ tone: "bad", text: `${fmtPct(abandon)} of shoppers who started checkout didn't finish.` });
    }
    if (s.orders >= 5) {
      const share = pct(s.returningCustomers, s.buyers);
      if (share !== null) items.push({ tone: share >= 20 ? "good" : "neutral", text: `${fmtPct(share)} of this period's buyers had ordered before.` });
    }
    if (!items.length) items.push({ tone: "neutral", text: "No big changes compared with the previous period." });
    blocks.splice(gaNotice(ctx).length + 1, 0, { type: "insights", id: "insights", title: "Quick insights", items: items.slice(0, 7) });
    return blocks;
  },
};
