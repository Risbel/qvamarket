import { and, asc, count, db, desc, eq, expense, inArray, member, or, sql, user } from "@qvashop/db";
import type { ExpenseCategory, ExpenseListParams, ExpenseSort } from "@/lib/expenses";
import type { ExpenseInput } from "@/lib/validation/expense";
import { onLocalDays } from "./date-sql";
import { inClosedPeriod } from "./register";

// Expenses of the merchant's store. Every query matches tenant_id AND store_id (from
// requireMerchant(), never from client input).

type Scope = { tenantId: string; storeId: string };

const inScope = ({ tenantId, storeId }: Scope) => and(eq(expense.tenantId, tenantId), eq(expense.storeId, storeId));

/** bigint sums come back from node-postgres as text */
const sumAmount = sql<number>`coalesce(sum(${expense.amountMinor}), 0)::bigint`.mapWith(Number);

function searchCondition(query: string) {
  const text = query.trim();
  if (!text) return undefined;
  const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return or(sql`${expense.payee} ilike ${like}`, sql`${expense.note} ilike ${like}`);
}

/** The list's filters (each optional); `except` leaves the category filter out, for its own counts. */
function listCondition(scope: Scope, params: ExpenseListParams, except?: "category") {
  return and(
    inScope(scope),
    except !== "category" && params.categories.length ? inArray(expense.category, params.categories) : undefined,
    // paid on those days in the range's timezone
    onLocalDays(expense.paidAt, params.range),
    searchCondition(params.query),
  );
}

function listOrderBy({ id, desc: descending }: ExpenseSort) {
  const dir = descending ? desc : asc;
  // Amounts only compare within one currency: group by currency first
  if (id === "amount") return [asc(expense.currencyCode), dir(expense.amountMinor), desc(expense.paidAt), asc(expense.id)];
  return [dir(expense.paidAt), asc(expense.id)];
}

/**
 * A page of expenses, how many match, and the totals of everything that matches per category
 * and currency (`byCategory` ignores the category filter, so it also gives that filter's
 * counts; the page adds up the chosen categories for its totals).
 */
export async function listExpenses(scope: Scope, params: ExpenseListParams) {
  const where = listCondition(scope, params);
  const [rows, [{ total }], byCategory] = await Promise.all([
    db
      .select({
        id: expense.id,
        category: expense.category,
        amountMinor: expense.amountMinor,
        currencyCode: expense.currencyCode,
        method: expense.method,
        paidAt: expense.paidAt,
        payee: expense.payee,
        memberUserId: expense.memberUserId,
        note: expense.note,
        recordedByName: user.name,
      })
      .from(expense)
      .leftJoin(user, eq(user.id, expense.recordedByUserId))
      .where(where)
      .orderBy(...listOrderBy(params.sort))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ total: count() }).from(expense).where(where),
    db
      .select({ category: expense.category, currencyCode: expense.currencyCode, count: count(), amountMinor: sumAmount })
      .from(expense)
      .where(listCondition(scope, params, "category"))
      .groupBy(expense.category, expense.currencyCode),
  ]);
  return {
    rows: rows.map((row) => ({ ...row, category: row.category as ExpenseCategory })),
    total,
    byCategory: byCategory.map((row) => ({ ...row, category: row.category as ExpenseCategory })),
  };
}

/** The company's team (for "paid to" on salaries), by name. */
export async function listExpenseMembers(tenantId: string) {
  return db
    .select({ userId: member.userId, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, tenantId))
    .orderBy(sql`${user.name} collate "und-x-icu"`);
}

/** Is `userId` a member of the company? */
async function isMember(tenantId: string, userId: string) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, tenantId), eq(member.userId, userId)))
    .limit(1);
  return Boolean(row);
}

export type SaveExpenseResult = { ok: true; id: string } | { ok: false; error: "notFound" | "memberNotFound" | "closedPeriod" };

/**
 * A salary keeps the member's current name as payee when none was typed. The member must be
 * in the company, except the one an existing expense already names (they may have left since).
 */
async function withMember(scope: Scope, input: ExpenseInput, keptMemberId?: string | null): Promise<ExpenseInput | null> {
  if (!input.memberUserId) return input;
  if (input.memberUserId !== keptMemberId && !(await isMember(scope.tenantId, input.memberUserId))) return null;
  if (input.payee) return input;
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, input.memberUserId));
  return { ...input, payee: row?.name.trim() || null };
}

export async function createExpense(scope: Scope, input: ExpenseInput, userId: string): Promise<SaveExpenseResult> {
  const values = await withMember(scope, input);
  if (!values) return { ok: false, error: "memberNotFound" };
  return db.transaction(async (tx) => {
    // an expense dated in a closed day would change its frozen cash count
    if (await inClosedPeriod(tx, scope, [values.paidAt])) return { ok: false, error: "closedPeriod" } as const;
    const [created] = await tx
      .insert(expense)
      .values({ ...values, tenantId: scope.tenantId, storeId: scope.storeId, recordedByUserId: userId })
      .returning({ id: expense.id });
    return { ok: true, id: created.id } as const;
  });
}

export async function updateExpense(scope: Scope, id: string, input: ExpenseInput): Promise<SaveExpenseResult> {
  const [current] = await db
    .select({ memberUserId: expense.memberUserId })
    .from(expense)
    .where(and(inScope(scope), eq(expense.id, id)));
  if (!current) return { ok: false, error: "notFound" };
  const values = await withMember(scope, input, current.memberUserId);
  if (!values) return { ok: false, error: "memberNotFound" };
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ paidAt: expense.paidAt })
      .from(expense)
      .where(and(inScope(scope), eq(expense.id, id)))
      .for("update");
    if (!locked) return { ok: false, error: "notFound" } as const;
    // neither the old date nor the new one may be in a closed day
    if (await inClosedPeriod(tx, scope, [locked.paidAt, values.paidAt])) return { ok: false, error: "closedPeriod" } as const;
    await tx.update(expense).set(values).where(and(inScope(scope), eq(expense.id, id)));
    return { ok: true, id } as const;
  });
}

/** `notFound` when the expense does not exist in this store; `closedPeriod` when it is in a closed day. */
export async function deleteExpense(scope: Scope, id: string): Promise<{ ok: true } | { ok: false; error: "notFound" | "closedPeriod" }> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ paidAt: expense.paidAt })
      .from(expense)
      .where(and(inScope(scope), eq(expense.id, id)))
      .for("update");
    if (!locked) return { ok: false, error: "notFound" } as const;
    if (await inClosedPeriod(tx, scope, [locked.paidAt])) return { ok: false, error: "closedPeriod" } as const;
    await tx.delete(expense).where(and(inScope(scope), eq(expense.id, id)));
    return { ok: true } as const;
  });
}
