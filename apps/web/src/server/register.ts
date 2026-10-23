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
  parseRecounts,
  parseRegisterReport,
  type DrawerCurrency,
  type RegisterMovementKind,
  type RegisterRecount,
  type RegisterReport,
} from "@/lib/register";

// The store's cash register (day close), one shift per cashier. Every function takes the
// scope from requireMerchant() / getMerchantOrNull() and filters by tenant_id AND store_id.
//
// A shift belongs to whoever opened it (the cashier). Payments, refunds and expenses recorded
// by the cashier while it is open are linked to it (`register_session_id`), and its drawer
// counts only those. A `Viewer` without `register:supervise` sees and acts on their own shifts
// only; a supervisor sees every shift and may close one on its cashier's behalf.
//
// Locks: opening locks the store row (numbers, one open shift per cashier); a movement or the
// close locks the shift FOR UPDATE; payment and expense writes take the shift they link to (or
// are linked to) FOR SHARE (`openShiftOf` / `inClosedShift`), so nothing lands in a shift
// while it is being closed, and rows of a closed shift are frozen.

type Scope = { tenantId: string; storeId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type RegisterViewer = { userId: string; supervise: boolean };

const sumMinor = (column: typeof orderPayment.amountMinor | typeof expense.amountMinor | typeof registerMovement.amountMinor | typeof order.totalMinor) =>
  sql<number>`coalesce(sum(${column}), 0)::bigint`.mapWith(Number);

const sessionScope = ({ tenantId, storeId }: Scope) =>
  and(eq(registerSession.tenantId, tenantId), eq(registerSession.storeId, storeId));

/** Only the viewer's own shifts, unless they supervise. */
const visibleTo = (viewer: RegisterViewer) => (viewer.supervise ? undefined : eq(registerSession.openedByUserId, viewer.userId));

// ---------------------------------------------------------------------------------------
// Links (used by payments and expenses)
// ---------------------------------------------------------------------------------------

/**
 * Inside a payment / expense write: the open shift of `userId` in the store, taken FOR SHARE
 * (waits for a close in progress, after which it is no longer open), or null. New rows are
 * linked to it; take "now" for their date after this call.
 */
export async function openShiftOf(tx: Tx, scope: Scope, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: registerSession.id })
    .from(registerSession)
    .where(and(sessionScope(scope), eq(registerSession.openedByUserId, userId), eq(registerSession.status, "open")))
    .for("share");
  return row?.id ?? null;
}

/**
 * Inside a payment / expense change or removal: is the row's shift closed? Its records are
 * then part of a frozen Z report (correct them with a new record instead). The shift is taken
 * FOR SHARE, so it cannot be closed while the change is made.
 */
export async function inClosedShift(tx: Tx, scope: Scope, sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false;
  const [row] = await tx
    .select({ status: registerSession.status })
    .from(registerSession)
    .where(and(sessionScope(scope), eq(registerSession.id, sessionId)))
    .for("share");
  return row?.status === "closed";
}

// ---------------------------------------------------------------------------------------
// Totals of a shift
// ---------------------------------------------------------------------------------------

/** The drawer of each currency: what is linked to the shift. */
async function sessionDrawers(executor: typeof db | Tx, scope: Scope, sessionId: string): Promise<DrawerCurrency[]> {
  const [openings, payments, expenses, movements, sales] = await Promise.all([
    executor
      .select({ currency: registerSessionCurrency.currencyCode, openingMinor: registerSessionCurrency.openingMinor })
      .from(registerSessionCurrency)
      .where(and(eq(registerSessionCurrency.sessionId, sessionId), eq(registerSessionCurrency.tenantId, scope.tenantId)))
      .orderBy(asc(registerSessionCurrency.currencyCode)),
    // order_payment has no currency: the order (same tenant and store) has it
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
      .where(and(eq(order.storeId, scope.storeId), eq(orderPayment.tenantId, scope.tenantId), eq(orderPayment.registerSessionId, sessionId)))
      .groupBy(order.currencyCode, orderPayment.method, orderPayment.kind),
    executor
      .select({ currency: expense.currencyCode, method: expense.method, amountMinor: sumMinor(expense.amountMinor), count: count() })
      .from(expense)
      .where(and(eq(expense.tenantId, scope.tenantId), eq(expense.storeId, scope.storeId), eq(expense.registerSessionId, sessionId)))
      .groupBy(expense.currencyCode, expense.method),
    executor
      .select({ currency: registerMovement.currencyCode, kind: registerMovement.kind, amountMinor: sumMinor(registerMovement.amountMinor) })
      .from(registerMovement)
      .where(and(eq(registerMovement.sessionId, sessionId), eq(registerMovement.tenantId, scope.tenantId)))
      .groupBy(registerMovement.currencyCode, registerMovement.kind),
    executor
      .select({ currency: order.currencyCode, orders: count(), totalMinor: sumMinor(order.totalMinor) })
      .from(order)
      .where(
        and(
          eq(order.tenantId, scope.tenantId),
          eq(order.storeId, scope.storeId),
          eq(order.registerSessionId, sessionId),
          ne(order.status, "cancelled"),
        ),
      )
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

/**
 * The open shifts the viewer can see (their own first, then the others' by opening time),
 * each with its live drawers and movements.
 */
export async function getOpenShifts(scope: Scope, viewer: RegisterViewer) {
  const sessions = await db
    .select({
      id: registerSession.id,
      number: registerSession.number,
      openedAt: registerSession.openedAt,
      openingNote: registerSession.openingNote,
      cashierUserId: registerSession.openedByUserId,
      cashier: user.name,
    })
    .from(registerSession)
    .leftJoin(user, eq(user.id, registerSession.openedByUserId))
    .where(and(sessionScope(scope), eq(registerSession.status, "open"), visibleTo(viewer)))
    .orderBy(asc(registerSession.openedAt));
  const shifts = await Promise.all(
    sessions.map(async (session) => {
      const [drawers, movements] = await Promise.all([sessionDrawers(db, scope, session.id), sessionMovements(db, scope, session.id)]);
      return { ...session, own: session.cashierUserId === viewer.userId, drawers, movements };
    }),
  );
  return shifts.sort((a, b) => Number(b.own) - Number(a.own));
}

/** Does `userId` have an open shift in the store? (Cash they record outside one is in no drawer.) */
export async function hasOpenShift(scope: Scope, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: registerSession.id })
    .from(registerSession)
    .where(and(sessionScope(scope), eq(registerSession.openedByUserId, userId), eq(registerSession.status, "open")));
  return Boolean(row);
}

/** The currencies (with their expected cash) of an open shift the viewer may close, or null. */
export async function getClosableShift(scope: Scope, sessionId: string, viewer: RegisterViewer) {
  const [session] = await db
    .select({ id: registerSession.id })
    .from(registerSession)
    .where(and(sessionScope(scope), eq(registerSession.id, sessionId), eq(registerSession.status, "open"), visibleTo(viewer)));
  return session ? { id: session.id, drawers: await sessionDrawers(db, scope, session.id) } : null;
}

/** What the cashier's last close counted per currency (suggested as the next opening float). */
export async function lastCounted(scope: Scope, userId: string): Promise<Record<string, number>> {
  const [last] = await db
    .select({ id: registerSession.id })
    .from(registerSession)
    .where(and(sessionScope(scope), eq(registerSession.status, "closed"), eq(registerSession.openedByUserId, userId)))
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

/** Closed shifts the viewer can see, newest first, with their per-currency difference. */
export async function listClosedSessions(scope: Scope, viewer: RegisterViewer) {
  const closer = sql<string | null>`(select ${user.name} from ${user} where ${user.id} = ${registerSession.closedByUserId})`;
  const sessions = await db
    .select({
      id: registerSession.id,
      number: registerSession.number,
      openedAt: registerSession.openedAt,
      closedAt: registerSession.closedAt,
      cashier: user.name,
      cashierUserId: registerSession.openedByUserId,
      closedByUserId: registerSession.closedByUserId,
      closedBy: closer,
    })
    .from(registerSession)
    .leftJoin(user, eq(user.id, registerSession.openedByUserId))
    .where(and(sessionScope(scope), eq(registerSession.status, "closed"), visibleTo(viewer)))
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

/** A closed shift's frozen report (null for another store's, one the viewer cannot see, an open one or an unknown id). */
export async function getSessionReport(scope: Scope, sessionId: string, viewer: RegisterViewer): Promise<RegisterReport | null> {
  const [row] = await db
    .select({ report: registerSession.report })
    .from(registerSession)
    .where(and(sessionScope(scope), eq(registerSession.id, sessionId), eq(registerSession.status, "closed"), visibleTo(viewer)));
  return row ? parseRegisterReport(row.report) : null;
}

// ---------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------

export type RegisterResult =
  | { ok: true; id?: string }
  | { ok: false; error: "alreadyOpen" | "noSession" | "invalidCurrency" | "exceedsCash" | "stale" | "missingCount" }
  /** the count does not match in these currencies: count again, or explain it in the note */
  | { ok: false; error: "noteRequired"; currencies: string[] };

/**
 * Opens the viewer's shift with a float per currency (the store's currencies; 0 is fine). The
 * store row is locked, so the number and "one open shift per cashier" hold under concurrent
 * clicks (the partial unique index is the last guard).
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
    const [open] = await tx
      .select({ id: registerSession.id })
      .from(registerSession)
      .where(and(sessionScope(scope), eq(registerSession.status, "open"), eq(registerSession.openedByUserId, userId)));
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

/** Locks an open shift: the viewer's own (`sessionId` null), or a given one they can see. */
async function lockOpenSession(tx: Tx, scope: Scope, viewer: RegisterViewer, sessionId: string | null) {
  const [session] = await tx
    .select({
      id: registerSession.id,
      number: registerSession.number,
      openedAt: registerSession.openedAt,
      openingNote: registerSession.openingNote,
      openedByUserId: registerSession.openedByUserId,
      recounts: registerSession.recounts,
    })
    .from(registerSession)
    .where(
      and(
        sessionScope(scope),
        eq(registerSession.status, "open"),
        sessionId ? and(eq(registerSession.id, sessionId), visibleTo(viewer)) : eq(registerSession.openedByUserId, viewer.userId),
      ),
    )
    .for("update");
  return session ?? null;
}

/**
 * Cash put into or taken out of the viewer's own drawer. Taking out more than the drawer
 * should hold in that currency is refused (`exceedsCash`). A currency the shift did not open
 * with gets a 0 float.
 */
export async function addRegisterMovement(
  scope: Scope,
  input: { kind: RegisterMovementKind; currencyCode: string; amountMinor: number; note: string },
  storeCurrencies: string[],
  viewer: RegisterViewer,
): Promise<RegisterResult> {
  if (!storeCurrencies.includes(input.currencyCode)) return { ok: false, error: "invalidCurrency" };
  return db.transaction(async (tx) => {
    const session = await lockOpenSession(tx, scope, viewer, null);
    if (!session) return { ok: false, error: "noSession" } as const;
    if (input.kind === "out") {
      const drawers = await sessionDrawers(tx, scope, session.id);
      const expected = drawers.find((d) => d.currency === input.currencyCode)?.expectedMinor ?? 0;
      if (input.amountMinor > expected) return { ok: false, error: "exceedsCash" } as const;
    }
    await tx
      .insert(registerSessionCurrency)
      .values({ ...scope, sessionId: session.id, currencyCode: input.currencyCode, openingMinor: 0 })
      .onConflictDoNothing();
    await tx.insert(registerMovement).values({ ...scope, sessionId: session.id, ...input, createdByUserId: viewer.userId });
    return { ok: true } as const;
  });
}

/**
 * Closes a shift: the viewer's own, or (supervisors) another cashier's. `counted` = the cash
 * per currency, typed blind (a cashier does not see what is expected). When a count does not
 * match and there is no note, nothing closes: the attempt is kept in `recounts` (it shows in
 * the report) and the answer names the currencies, so the person counts again or explains.
 * `shown` = the expected amounts a supervisor saw: if anything was paid meanwhile they differ
 * and the close is refused (`stale`). Writes the counts and the frozen report in one
 * transaction.
 */
export async function closeRegister(
  scope: Scope,
  sessionId: string,
  input: { counted: Record<string, number>; shown: Record<string, number> | null; note: string },
  viewer: RegisterViewer,
): Promise<RegisterResult> {
  return db.transaction(async (tx) => {
    const session = await lockOpenSession(tx, scope, viewer, sessionId);
    if (!session) return { ok: false, error: "noSession" } as const;
    const closedAt = new Date();
    const drawers = await sessionDrawers(tx, scope, session.id);
    if (drawers.some((d) => input.counted[d.currency] === undefined)) return { ok: false, error: "missingCount" } as const;
    if (input.shown && drawers.some((d) => input.shown![d.currency] !== d.expectedMinor)) return { ok: false, error: "stale" } as const;
    const differing = drawers.filter((d) => input.counted[d.currency] !== d.expectedMinor).map((d) => d.currency);
    const recounts = parseRecounts(session.recounts);
    if (differing.length > 0 && !input.note) {
      const attempt: RegisterRecount = {
        at: closedAt.toISOString(),
        byUserId: viewer.userId,
        counted: Object.fromEntries(drawers.map((d) => [d.currency, input.counted[d.currency]])),
      };
      await tx
        .update(registerSession)
        .set({ recounts: [...recounts, attempt] })
        .where(and(sessionScope(scope), eq(registerSession.id, session.id)));
      return { ok: false, error: "noteRequired", currencies: differing } as const;
    }

    const userIds = [...new Set([viewer.userId, ...(session.openedByUserId ? [session.openedByUserId] : []), ...recounts.map((r) => r.byUserId)])];
    const names = await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds));
    const nameOf = (id: string | null) => names.find((n) => n.id === id)?.name ?? null;
    const movements = await sessionMovements(tx, scope, session.id);
    const report: RegisterReport = {
      version: 1,
      number: session.number,
      openedAt: session.openedAt.toISOString(),
      closedAt: closedAt.toISOString(),
      openedBy: nameOf(session.openedByUserId),
      closedBy: nameOf(viewer.userId),
      currencies: drawers.map((d) => ({ ...d, countedMinor: input.counted[d.currency], differenceMinor: input.counted[d.currency] - d.expectedMinor })),
      movements: movements.map((m) => ({
        kind: m.kind as RegisterMovementKind,
        currency: m.currency,
        amountMinor: m.amountMinor,
        note: m.note,
        at: m.createdAt.toISOString(),
        by: m.by,
      })),
      recounts: recounts.map((r) => ({ at: r.at, by: nameOf(r.byUserId), counted: r.counted })),
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
      .set({ status: "closed", closedAt, closedByUserId: viewer.userId, closingNote: input.note || null, report })
      .where(and(sessionScope(scope), eq(registerSession.id, session.id)));
    return { ok: true, id: session.id } as const;
  });
}
