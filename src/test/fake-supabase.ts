/**
 * In-memory stand-in for the Supabase client, just rich enough to run the real Express app
 * in tests: the query-builder chain (select / filters / order / range / single / maybeSingle,
 * insert / update / upsert / delete), nested relation selects resolved by foreign-key naming
 * convention, unique constraints (reported as Postgres 23505) and the few RPCs the app calls.
 */
import { randomUUID } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

interface RelNode {
  key: string; // property name on the result (alias or table)
  table: string;
  fk?: string; // FK column hint from `table!xxx_fkey`
  inner: boolean;
  children: RelNode[];
}

/** Unique constraints enforced on insert/update (column lists). */
const UNIQUE: Record<string, string[][]> = {
  orders: [["order_number"], ["idempotency_key"]],
  invoices: [["order_id"], ["invoice_number"]],
  wishlist_items: [["customer_id", "product_id"]],
  user_roles: [["user_id", "role_id"]],
  coupons: [["code"]],
};

const singular = (t: string) => (t.endsWith("ies") ? t.slice(0, -3) + "y" : t.endsWith("s") ? t.slice(0, -1) : t);

/** Parses a PostgREST select string into its relation tree (columns are always returned whole). */
function parseSelect(sel: string): RelNode[] {
  const nodes: RelNode[] = [];
  let i = 0;
  const s = sel.replace(/\s+/g, "");
  const parseList = (): RelNode[] => {
    const out: RelNode[] = [];
    while (i < s.length && s[i] !== ")") {
      let token = "";
      while (i < s.length && !",()".includes(s[i])) token += s[i++];
      if (s[i] === "(") {
        i++;
        const children = parseList();
        i++; // ')'
        let table = token;
        let alias: string | undefined;
        if (token.includes(":")) [alias, table] = token.split(":");
        let fk: string | undefined;
        if (table.includes("!")) {
          const [t, hint] = table.split("!");
          table = t;
          if (hint !== "inner") fk = hint;
        }
        out.push({ key: alias ?? table, table, fk, inner: token.includes("!inner"), children });
      }
      if (s[i] === ",") i++;
    }
    return out;
  };
  nodes.push(...parseList());
  return nodes;
}

export class FakeSupabase {
  tables: Tables = {};
  rpcHandlers: Record<string, (args: any, db: FakeSupabase) => any> = {};
  counters: Record<string, number> = {};
  /** Auth users by id, for the few `auth.admin` lookups the app makes. */
  users: Record<string, { id: string; email: string }> = {};
  auth = {
    admin: {
      getUserById: async (id: string) => {
        const user = this.users[id];
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "User not found" } };
      },
    },
  };

  constructor(seed: Tables = {}) {
    this.reset(seed);
    this.rpcHandlers = {
      decrement_product_stock: ({ p_product_id, p_qty }) => {
        const p = this.tables.products?.find((r) => r.id === p_product_id);
        if (!p || p.stock < p_qty) return false;
        p.stock -= p_qty;
        return true;
      },
      increment_product_stock: ({ p_product_id, p_qty }) => {
        const p = this.tables.products?.find((r) => r.id === p_product_id);
        if (p) p.stock += p_qty;
        return null;
      },
      increment_coupon_uses: ({ p_coupon_id }) => {
        const c = this.tables.coupons?.find((r) => r.id === p_coupon_id);
        if (c) c.uses_count = (c.uses_count ?? 0) + 1;
        return null;
      },
      next_order_number: () => `ORD-2026-${String((this.counters.order = (this.counters.order ?? 0) + 1)).padStart(4, "0")}`,
      next_invoice_number: () => `INV-2026-${String((this.counters.invoice = (this.counters.invoice ?? 0) + 1)).padStart(4, "0")}`,
    };
  }

  reset(seed: Tables = {}) {
    this.tables = JSON.parse(JSON.stringify(seed));
    this.counters = {};
    this.users = {};
  }

  table(name: string) {
    return (this.tables[name] ??= []);
  }

  from(name: string) {
    return new Query(this, name);
  }

  async rpc(name: string, args: any) {
    const fn = this.rpcHandlers[name];
    if (!fn) return { data: null, error: { message: `rpc ${name} not implemented` } };
    return { data: fn(args, this), error: null };
  }

  /** Attaches relation data to a row following FK naming conventions. */
  resolve(tableName: string, row: Row, rels: RelNode[]): Row {
    const out: Row = { ...row };
    for (const rel of rels) {
      let col: string | undefined;
      if (rel.fk) {
        col = rel.fk.replace(/_fkey$/, "");
        for (const prefix of [`${tableName}_`, `${rel.table}_`]) if (col.startsWith(prefix)) col = col.slice(prefix.length);
      }
      // belongs-to when the FK column lives on this row, otherwise has-many (FK on the child)
      const belongsCol = col ? (col in row ? col : undefined) : `${singular(rel.table)}_id` in row ? `${singular(rel.table)}_id` : undefined;
      if (belongsCol) {
        const target = this.table(rel.table).find((r) => r.id === row[belongsCol]);
        out[rel.key] = target ? this.resolve(rel.table, target, rel.children) : null;
        continue;
      }
      const childCol = col ?? `${singular(tableName)}_id`;
      const children = this.table(rel.table).filter((r) => r[childCol] === row.id);
      // one-to-one tables come back as an object, like PostgREST does for unique FKs
      const oneToOne = ["customization_rules", "invoices"].includes(rel.table);
      const resolved = children.map((c) => this.resolve(rel.table, c, rel.children));
      out[rel.key] = oneToOne ? resolved[0] ?? null : resolved;
    }
    return out;
  }

  uniqueViolation(tableName: string, candidate: Row, ignoreId?: string) {
    for (const cols of UNIQUE[tableName] ?? []) {
      if (cols.some((c) => candidate[c] === undefined || candidate[c] === null)) continue;
      const clash = this.table(tableName).find((r) => r.id !== ignoreId && cols.every((c) => r[c] === candidate[c]));
      if (clash) return { code: "23505", message: `duplicate key value violates unique constraint on ${tableName}(${cols.join(",")})` };
    }
    return null;
  }
}

type Filter = (r: Row) => boolean;

class Query implements PromiseLike<any> {
  private filters: Filter[] = [];
  private rels: RelNode[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: any;
  private upsertConflict?: string[];
  private orderBy: { col: string; asc: boolean }[] = [];
  private rangeFrom?: number;
  private rangeTo?: number;
  private single_: "one" | "maybe" | null = null;
  private countMode = false;
  private headOnly = false;
  private returning = false;

  constructor(private db: FakeSupabase, private name: string) {}

  select(sel = "*", opts: { count?: string; head?: boolean } = {}) {
    this.rels = parseSelect(sel);
    if (opts.count) this.countMode = true;
    if (opts.head) this.headOnly = true;
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string } = {}) {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.upsertConflict = opts.onConflict?.split(",").map((c) => c.trim()) ?? ["id"];
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }

  eq(col: string, v: any) {
    this.filters.push((r) => (typeof r[col] === "object" && r[col] !== null ? JSON.stringify(r[col]) === (typeof v === "string" ? v : JSON.stringify(v)) : r[col] === v));
    return this;
  }
  neq(col: string, v: any) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  in(col: string, vs: any[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  gte(col: string, v: any) {
    this.filters.push((r) => r[col] >= v);
    return this;
  }
  lte(col: string, v: any) {
    this.filters.push((r) => r[col] <= v);
    return this;
  }
  lt(col: string, v: any) {
    this.filters.push((r) => r[col] < v);
    return this;
  }
  gt(col: string, v: any) {
    this.filters.push((r) => r[col] > v);
    return this;
  }
  is(col: string, v: any) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  ilike(col: string, pattern: string) {
    const re = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i");
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }
  or() {
    return this; // search helpers aren't exercised by these tests
  }
  not() {
    return this;
  }
  filter() {
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push({ col, asc: opts.ascending !== false });
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  limit(n: number) {
    this.rangeFrom = 0;
    this.rangeTo = n - 1;
    return this;
  }
  single() {
    this.single_ = "one";
    return this;
  }
  maybeSingle() {
    this.single_ = "maybe";
    return this;
  }

  private matches() {
    return this.db.table(this.name).filter((r) => this.filters.every((f) => f(r)));
  }

  private shape(rows: Row[]) {
    let out = rows.map((r) => this.db.resolve(this.name, r, this.rels));
    for (const o of [...this.orderBy].reverse()) {
      out = out.sort((a, b) => (a[o.col] === b[o.col] ? 0 : (a[o.col] > b[o.col] ? 1 : -1) * (o.asc ? 1 : -1)));
    }
    const count = out.length;
    if (this.rangeFrom !== undefined) out = out.slice(this.rangeFrom, (this.rangeTo ?? out.length) + 1);
    if (this.single_) {
      if (out.length === 0) return this.single_ === "one" ? { data: null, error: { code: "PGRST116", message: "no rows" } } : { data: null, error: null };
      return { data: out[0], error: null };
    }
    return { data: this.headOnly ? null : out, error: null, count: this.countMode ? count : null };
  }

  private run(): any {
    const t = this.db.table(this.name);
    const now = new Date().toISOString();
    if (this.op === "select") return this.shape(this.matches());

    if (this.op === "insert" || this.op === "upsert") {
      const written: Row[] = [];
      for (const raw of this.payload as Row[]) {
        if (this.op === "upsert") {
          const existing = t.find((r) => this.upsertConflict!.every((c) => r[c] === raw[c]));
          if (existing) {
            Object.assign(existing, raw, { updated_at: now });
            written.push(existing);
            continue;
          }
        }
        const row = { id: raw.id ?? randomUUID(), created_at: now, ...raw };
        const clash = this.db.uniqueViolation(this.name, row);
        if (clash) return { data: null, error: clash };
        t.push(row);
        written.push(row);
      }
      if (!this.returning) return { data: null, error: null };
      return this.single_ ? this.shape([written[0]]) : { data: written.map((r) => this.db.resolve(this.name, r, this.rels)), error: null };
    }

    if (this.op === "update") {
      const rows = this.matches();
      for (const r of rows) {
        const clash = this.db.uniqueViolation(this.name, { ...r, ...this.payload }, r.id);
        if (clash) return { data: null, error: clash };
      }
      rows.forEach((r) => Object.assign(r, this.payload));
      if (!this.returning) return { data: null, error: null };
      return this.single_ ? this.shape(rows) : { data: rows.map((r) => this.db.resolve(this.name, r, this.rels)), error: null };
    }

    // delete
    const doomed = new Set(this.matches());
    this.db.tables[this.name] = t.filter((r) => !doomed.has(r));
    return { data: this.returning ? [...doomed] : null, error: null };
  }

  then<T1 = any, T2 = never>(onfulfilled?: ((value: any) => T1 | PromiseLike<T1>) | null, onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }
}
