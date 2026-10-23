import {
  and,
  asc,
  count,
  db,
  desc,
  eq,
  expense,
  inArray,
  ne,
  order,
  orderPayment,
  registerMovement,
  registerSession,
  registerSessionCurrency,
  sql,
  store,
  user,
} from "@qvashop/db";
import {
  drawerTotals,
  parseRegisterReport,
  type DrawerCurrency,
  type RegisterMovementKind,
  type RegisterReport,
} from "@/lib/register";

// The store's cash register (day close). Every function takes the scope from
// requireMerchant() / getMerchantOrNull() and filters by tenant_id AND store_id.
//
// Locks: opening locks the store row (numbers, one open session); a movement or the close
// locks the open session FOR UPDATE; payment and expense writes take it FOR SHARE
// (`lockOpenPeriod`), so nothing can be paid into a session while it is being closed, and
// they are refused when their date falls in a period already closed.

type Scope = { tenantId: string; storeId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const sumMinor = (column: typeof orderPayment.amountMinor | typeof expense.amountMinor | typeof registerMovement.amountMinor | typeof order.totalMinor) =>
  sql<number>`coalesce(sum(${column}), 0)::bigint`.mapWith(Number);

const sessionScope = ({ tenantId, storeId }: Scope) =>
  and(eq(registerSession.tenantId, tenantId), eq(registerSession.storeId, storeId));

// ---------------------------------------------------------------------------------------
// Closed periods (used by payments and expenses)
// ---------------------------------------------------------------------------------------

/**
 * Inside a payment / expense write: takes the open session FOR SHARE (waits for a close in
 * progress) and answers whether any of `dates` falls before the end of the last closed
 * session, i.e. in a period whose report is frozen. Payments and expenses there cannot be
 * added, backdated into, changed or removed; corrections go in the open period.
 */
export async function inClosedPeriod(tx: Tx, scope: Scope, dates: Date[]): Promise<boolean> {
  await tx.select({ id: registerSession.id }).from(registerSession).where(and(sessionScope(scope), eq(registerSession.status, "open"))).for("share");
  const [last] = await tx
    .select({ closedAt: registerSession.closedAt })
    .from(registerSession)
    .where(and(sessionScope(scope), eq(registerSession.status, "closed")))
    .orderBy(desc(registerSession.closedAt))
    .limit(1);
  const end = last?.closedAt;
  return Boolean(end && dates.some((date) => date < end));
}

/** The end of the last closed period (forms use it as the earliest allowed date), or null. */
export async function lastClosedAt(scope: Scope): Promise<Date | null> {
  const [last] = await db
    .select({ closedAt: registerSession.closedAt })
    .from(registerSession)
    .where(and(sessionScope(scope), eq(registerSession.status, "closed")))
    .orderBy(desc(registerSession.closedAt))
    .limit(1);
  return last?.closedAt ?? null;
}

// ---------------------------------------------------------------------------------------
// Totals of a session
// ---------------------------------------------------------------------------------------

/** The drawer of each currency for the time [from, to) (to = null: up to now). */
async function sessionDrawers(
  executor: typeof db | Tx,
  scope: Scope,
  session: { id: string; openedAt: Date },
  to: Date | null,
): Promise<DrawerCurrency[]> {
  const inStore = and(eq(order.tenantId, scope.tenantId), eq(order.storeId, scope.storeId));
  const window = <T extends typeof orderPayment.paidAt | typeof expense.paidAt | typeof order.createdAt>(column: T) =>
    to ? and(sql`${column} >= ${session.openedAt}`, sql`${column} < ${to}`) : sql`${column} >= ${session.openedAt}`;

  const [openings, payments, expenses, movements, sales] = await Promise.all([
    executor
      .select({ currency: registerSessionCurrency.currencyCode, openingMinor: registerSessionCurrency.openingMinor })
      .from(registerSessionCurrency)
      .where(and(eq(registerSessionCurrency.sessionId, session.id), eq(registerSessionCurrency.tenantId, scope.tenantId)))
      .orderBy(asc(registerSessionCurrency.currencyCode)),
    // order_payment has no store_id: the order (same tenant) says which store it belongs to
    executor
      .select({
        currency: order.currencyCode,
        method: orderPayment.method,
        kind: orderPayment.kind,
        amountMinor: sumMinor(orderPayment.amountMinor),
        count: count(),
      })
      .from(orderPayment)
      .innerJoin(order, and(eq(order.id, orderPayment.orderId), eq(order.tenantId, orderPayment.tenantId)))
      .where(and(inStore, eq(orderPayment.tenantId, scope.tenantId), window(orderPayment.paidAt)))
      .groupBy(order.currencyCode, orderPayment.method, orderPayment.kind),
    executor
      .select({ currency: expense.currencyCode, method: expense.method, amountMinor: sumMinor(expense.amountMinor), count: count() })
      .from(expense)
      .where(and(eq(expense.tenantId, scope.tenantId), eq(expense.storeId, scope.storeId), window(expense.paidAt)))
      .groupBy(expense.currencyCode, expense.method),
    executor
      .select({ currency: registerMovement.currencyCode, kind: registerMovement.kind, amountMinor: sumMinor(registerMovement.amountMinor) })
      .from(registerMovement)
      .where(and(eq(registerMovement.sessionId, session.id), eq(registerMovement.tenantId, scope.tenantId)))
      .groupBy(registerMovement.currencyCode, registerMovement.kind),
    executor
      .select({ currency: order.currencyCode, orders: count(), totalMinor: sumMinor(order.totalMinor) })
      .from(order)
      .where(and(inStore, ne(order.status, "cancelled"), window(order.createdAt)))
      .groupBy(order.currencyCode),
  ]);
  return drawerTotals({ openings, payments, expenses, movements, sales });
}

async function sessionMovements(executor: typeof db | Tx, scope: Scope, sessionId: string) {
  return executor
    .select({
      id: registerMovement.id,
      kind: registerMovement.kind,
      currency: registerMovement.currencyCode,
      amountMinor: registerMovement.amountMinor,
      note: registerMovement.note,
      createdAt: registerMovement.createdAt,
      by: user.name,
    })
    .from(registerMovement)
    .leftJoin(user, eq(user.id, registerMovement.createdByUserId))
    .where(and(eq(registerMovement.sessionId, sessionId), eq(registerMovement.tenantId, scope.tenantId)))
    .orderBy(asc(registerMovement.createdAt));
}

// ---------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------

/** The open session with its live drawers and movements, or null. */
export async function getOpenRegister(scope: Scope) {
  const [session] = await db
    .select({
      id: registerSession.id,
      number: registerSession.number,
      openedAt: registerSession.openedAt,
      openingNote: registerSession.openingNote,
      openedBy: user.name,
    })
    .from(registerSession)
    .leftJoin(user, eq(user.id, registerSession.openedByUserId))
    .where(and(sessionScope(scope), eq(registerSession.status, "open")));
  if (!session) return null;
  const [drawers, movements] = await Promise.all([sessionDrawers(db, scope, session, null), sessionMovements(db, scope, session.id)]);
  return { ...session, drawers, movements };
}

/** What the last close counted per currency (suggested as the next opening float). */
export async function lastCounted(scope: Scope): Promise<Record<string, number>> {
  const [last] = await db
    .select({ id: registerSession.id })
    .from(registerSession)
    .where(and(sessionScope(scope), eq(registerSession.status, "closed")))
    .orderBy(desc(registerSession.closedAt))
    .limit(1);
  if (!last) return {};
  const rows = await db
    .select({ currency: registerSessionCurrency.currencyCode, countedMinor: registerSessionCurrency.countedMinor })
    .from(registerSessionCurrency)
    .where(and(eq(registerSessionCurrency.sessionId, last.id), eq(registerSessionCurrency.tenantId, scope.tenantId)));
  return Object.fromEntries(rows.map((r) => [r.currency, r.countedMinor ?? 0]));
}

export const HISTORY_SIZE = 30;

/** Closed sessions, newest first, with their per-currency difference (`before`: older pages). */
export async function listClosedSessions(scope: Scope, before: Date | null = null) {
  const sessions = await db
    .select({
      id: registerSession.id,
      number: registerSession.number,
      openedAt: registerSession.openedAt,
      closedAt: registerSession.closedAt,
      closedBy: user.name,
    })
    .from(registerSession)
    .leftJoin(user, eq(user.id, registerSession.closedByUserId))
    .where(and(sessionScope(scope), eq(registerSession.status, "closed"), before ? sql`${registerSession.closedAt} < ${before}` : undefined))
    .orderBy(desc(registerSession.closedAt))
    .limit(HISTORY_SIZE);
  const currencies = sessions.length
    ? await db
        .select({
          sessionId: registerSessionCurrency.sessionId,
          currency: registerSessionCurrency.currencyCode,
          expectedMinor: registerSessionCurrency.expectedMinor,
          countedMinor: registerSessionCurrency.countedMinor,
        })
        .from(registerSessionCurrency)
        .where(and(eq(registerSessionCurrency.tenantId, scope.tenantId), inArray(registerSessionCurrency.sessionId, sessions.map((s) => s.id))))
    : [];
  return sessions.map((s) => ({
    ...s,
    currencies: currencies
      .filter((c) => c.sessionId === s.id)
      .map((c) => ({ currency: c.currency, differenceMinor: (c.countedMinor ?? 0) - (c.expectedMinor ?? 0) })),
  }));
}

/** A closed session's frozen report (null for another store's, an open one or an unknown id). */
export async function getSessionReport(scope: Scope, sessionId: string): Promise<RegisterReport | null> {
  const [row] = await db
    .select({ report: registerSession.report })
    .from(registerSession)
    .where(and(sessionScope(scope), eq(registerSession.id, sessionId), eq(registerSession.status, "closed")));
  return row ? parseRegisterReport(row.report) : null;
}

// ---------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------

export type RegisterResult =
  | { ok: true; id?: string }
  | { ok: false; error: "alreadyOpen" | "noSession" | "invalidCurrency" | "exceedsCash" | "stale" | "noteRequired" | "missingCount" };

/**
 * Opens the store's register with a float per currency (the store's currencies; 0 is fine).
 * The store row is locked, so the number and "one open at a time" hold under concurrent clicks
 * (the partial unique index is the last guard).
 */
export async function openRegister(
  scope: Scope,
  input: { floats: Record<string, number>; note: string },
  storeCurrencies: string[],
  userId: string,
): Promise<RegisterResult> {
  const codes = Object.keys(input.floats);
  if (codes.length === 0 || codes.some((code) => !storeCurrencies.includes(code))) return { ok: false, error: "invalidCurrency" };
  return db.transaction(async (tx) => {
    await tx
      .select({ id: store.id })
      .from(store)
      .where(and(eq(store.id, scope.storeId), eq(store.tenantId, scope.tenantId)))
      .for("no key update");
    const [open] = await tx.select({ id: registerSession.id }).from(registerSession).where(and(sessionScope(scope), eq(registerSession.status, "open")));
    if (open) return { ok: false, error: "alreadyOpen" } as const;
    const [{ last }] = await tx
      .select({ last: sql<number>`coalesce(max(${registerSession.number}), 0)`.mapWith(Number) })
      .from(registerSession)
      .where(sessionScope(scope));
    const [created] = await tx
      .insert(registerSession)
      .values({ ...scope, number: last + 1, openedByUserId: userId, openedAt: new Date(), openingNote: input.note || null })
      .returning({ id: registerSession.id });
    await tx.insert(registerSessionCurrency).values(
      codes.map((code) => ({ ...scope, sessionId: created.id, currencyCode: code, openingMinor: input.floats[code] })),
    );
    return { ok: true, id: created.id } as const;
  });
}

async function lockOpenSession(tx: Tx, scope: Scope) {
  const [session] = await tx
    .select({ id: registerSession.id, number: registerSession.number, openedAt: registerSession.openedAt, openingNote: registerSession.openingNote, openedByUserId: registerSession.openedByUserId })
    .from(registerSession)
    .where(and(sessionScope(scope), eq(registerSession.status, "open")))
    .for("update");
  return session ?? null;
}

/**
 * Cash put into or taken out of the drawer. Taking out more than the drawer should hold in
 * that currency is refused (`exceedsCash`). A currency the session did not open with gets a
 * 0 float.
 */
export async function addRegisterMovement(
  scope: Scope,
  input: { kind: RegisterMovementKind; currencyCode: string; amountMinor: number; note: string },
  storeCurrencies: string[],
  userId: string,
): Promise<RegisterResult> {
  if (!storeCurrencies.includes(input.currencyCode)) return { ok: false, error: "invalidCurrency" };
  return db.transaction(async (tx) => {
    const session = await lockOpenSession(tx, scope);
    if (!session) return { ok: false, error: "noSession" } as const;
    if (input.kind === "out") {
      const drawers = await sessionDrawers(tx, scope, session, null);
      const expected = drawers.find((d) => d.currency === input.currencyCode)?.expectedMinor ?? 0;
      if (input.amountMinor > expected) return { ok: false, error: "exceedsCash" } as const;
    }
    await tx
      .insert(registerSessionCurrency)
      .values({ ...scope, sessionId: session.id, currencyCode: input.currencyCode, openingMinor: 0 })
      .onConflictDoNothing();
    await tx.insert(registerMovement).values({ ...scope, sessionId: session.id, ...input, createdByUserId: userId });
    return { ok: true } as const;
  });
}

/**
 * Closes the open session: `counted` cash per currency against what is expected right now.
 * `shown` = the expected amounts the person saw: if anything was paid meanwhile they differ
 * and the close is refused (`stale`), so nobody signs a count against numbers they did not
 * see. A difference needs a note. Writes the counts and the frozen report in one transaction.
 */
export async function closeRegister(
  scope: Scope,
  input: { counted: Record<string, number>; shown: Record<string, number>; note: string },
  userId: string,
): Promise<RegisterResult> {
  return db.transaction(async (tx) => {
    const session = await lockOpenSession(tx, scope);
    if (!session) return { ok: false, error: "noSession" } as const;
    const closedAt = new Date();
    const drawers = await sessionDrawers(tx, scope, session, closedAt);
    if (drawers.some((d) => input.counted[d.currency] === undefined)) return { ok: false, error: "missingCount" } as const;
    if (drawers.some((d) => input.shown[d.currency] !== d.expectedMinor)) return { ok: false, error: "stale" } as const;
    const differs = drawers.some((d) => input.counted[d.currency] !== d.expectedMinor);
    if (differs && !input.note) return { ok: false, error: "noteRequired" } as const;

    const names = await tx
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, [userId, ...(session.openedByUserId ? [session.openedByUserId] : [])]));
    const nameOf = (id: string | null) => names.find((n) => n.id === id)?.name ?? null;
    const movements = await sessionMovements(tx, scope, session.id);
    const report: RegisterReport = {
      version: 1,
      number: session.number,
      openedAt: session.openedAt.toISOString(),
      closedAt: closedAt.toISOString(),
      openedBy: nameOf(session.openedByUserId),
      closedBy: nameOf(userId),
      currencies: drawers.map((d) => ({ ...d, countedMinor: input.counted[d.currency], differenceMinor: input.counted[d.currency] - d.expectedMinor })),
      movements: movements.map((m) => ({
        kind: m.kind as RegisterMovementKind,
        currency: m.currency,
        amountMinor: m.amountMinor,
        note: m.note,
        at: m.createdAt.toISOString(),
        by: m.by,
      })),
      openingNote: session.openingNote,
      closingNote: input.note || null,
    };

    for (const d of drawers) {
      await tx
        .insert(registerSessionCurrency)
        .values({ ...scope, sessionId: session.id, currencyCode: d.currency, openingMinor: d.openingMinor, expectedMinor: d.expectedMinor, countedMinor: input.counted[d.currency] })
        .onConflictDoUpdate({
          target: [registerSessionCurrency.sessionId, registerSessionCurrency.currencyCode],
          set: { expectedMinor: d.expectedMinor, countedMinor: input.counted[d.currency] },
        });
    }
    await tx
      .update(registerSession)
      .set({ status: "closed", closedAt, closedByUserId: userId, closingNote: input.note || null, report })
      .where(and(sessionScope(scope), eq(registerSession.id, session.id)));
    return { ok: true, id: session.id } as const;
  });
}

