# SDE Intern Assignment: Shared Bill Splitter

Welcome. In this assignment you build a small bill splitter for a shared home. It has two parts:

1. **Homes and members:** create a home and add members to it.
2. **Bill splitting:** split a bill between the members. Each member pays their own share.

The assignment is small on purpose. We want correct, safe, and clear code. We do not want many features.

## Architecture & System Design

```
┌────────────────────────────────────────────────────────┐
│               Frontend: React 19 + Vite                │
│             (TanStack Router, Resilient UI)            │
│               http://localhost:5173                    │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / JSON API
                           ▼
┌────────────────────────────────────────────────────────┐
│            Backend: Hono on Cloudflare Workers         │
│          (Edge Runtime, Zero-any TypeScript)           │
│               http://localhost:8787                    │
└──────────────────────────┬─────────────────────────────┘
                           │ D1 Driver
                           ▼
┌────────────────────────────────────────────────────────┐
│            Database: Cloudflare D1 (SQLite)            │
│     (7 Named Integrity Constraints & Foreign Keys)     │
└────────────────────────────────────────────────────────┘
```

### 1. End-to-End Component Flow

1. **Client Tier (Web):**
   - Built with **React 19**, **Vite**, and **TanStack Router**.
   - Fully decoupled UI with dedicated states for **loading** (skeleton pulses), **empty** (guided prompts to create homes and members), and **error** (inline alert banners with retry and dismiss options).
   - Defensive payment handling: automatically generates UUID idempotency keys, optimistically marks shares as paid, and preserves the share as unpaid if the API rejects or fails.

2. **API Tier (Workers):**
   - Built with **Hono** running on the Cloudflare Workers edge runtime.
   - Enforces strict request schema validation, integer amount bounds checking, and normalized error responses `{ "error": "message" }`.
   - Executes atomic batched queries (`c.env.DB.batch(...)`) for composite operations like creating a bill and all its individual member shares in a single transactional step.

3. **Storage Tier (D1 SQLite):**
   - All financial amounts are stored as whole integer **cents** (`amount_cents`, `total_cents`) to completely eliminate IEEE 754 floating-point inaccuracies.
   - Protects referential and financial integrity using 7 named constraints applied via migration `0001_init.sql`.

---

### 2. Core Data Flow & Algorithms

- **Deterministic Remainder Splitting:**
  When a bill of `totalCents` is split across $N$ members:
  $$\text{baseShare} = \lfloor \text{totalCents} / N \rfloor, \quad \text{remainder} = \text{totalCents} \pmod N$$
  Members are ordered by addition sequence (`ORDER BY rowid ASC`). The first `remainder` members receive $\text{baseShare} + 1$, and subsequent members receive $\text{baseShare}$.
  _Example:_ 1000 cents split between 3 members yields `[334, 333, 333]` cents. The shares always strictly sum to `totalCents`.

- **Concurrency-Safe Idempotent Payments:**
  Share payments require an `Idempotency-Key` header. Concurrency control uses an atomic conditional update:

  ```sql
  UPDATE shares
  SET paid_at = ?, idempotency_key = ?
  WHERE id = ? AND bill_id = ? AND paid_at IS NULL
  ```

  - **First attempt:** Matches the unpaid share, updates `changes === 1`, and returns `200 OK`.
  - **Duplicate attempt (same key):** Detects existing payment with matching key and idempotently returns `200 OK` with original `paidAt`.
  - **Concurrent attempt (different key):** Fails conditional update (`changes === 0`) or triggers unique constraint `uq_shares_idempotency_key`, returning `409 Conflict`.

- **Correlated Balance Aggregation:**
  `GET /api/homes/:homeId/balances` calculates the sum of all unpaid shares for every member across all home bills:

  ```sql
  SELECT m.id AS memberId, m.name,
    COALESCE((
      SELECT SUM(s.amount_cents)
      FROM shares s
      JOIN bills b ON s.bill_id = b.id
      WHERE s.member_id = m.id AND b.home_id = m.home_id AND s.paid_at IS NULL
    ), 0) AS outstandingCents
  FROM members m WHERE m.home_id = ? ORDER BY m.rowid ASC;
  ```

  Isolates aggregation per member, guaranteeing housemates with zero debt report `0` cents without outer-join duplication risks.

---

### 3. Database Schema & Named Constraints

| Constraint Name              |    Type     | Table     | Purpose                                                       |
| :--------------------------- | :---------: | :-------- | :------------------------------------------------------------ |
| `fk_members_home`            | Foreign Key | `members` | Prevents orphan members; cascades home deletion.              |
| `chk_bills_total_positive`   |    CHECK    | `bills`   | Ensures `total_cents > 0`, blocking zero/negative bills.      |
| `fk_bills_home`              | Foreign Key | `bills`   | Prevents orphan bills; cascades home deletion.                |
| `chk_shares_amount_positive` |    CHECK    | `shares`  | Ensures `amount_cents > 0`, preventing invalid share amounts. |
| `uq_shares_idempotency_key`  |   UNIQUE    | `shares`  | Prevents duplicate payments with different keys.              |
| `fk_shares_bill`             | Foreign Key | `shares`  | Enforces share association to existing bills.                 |
| `fk_shares_member`           | Foreign Key | `shares`  | Enforces share association to existing members.               |

---

### 4. Edge Cases Handled

| Case  | Scenario                          | Handling & Response                                                                                              |
| :---: | :-------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **1** | Home with no members              | Returns `422 Unprocessable Entity`; UI disables bill creation and presents a clear guide warning.                |
| **2** | Amount $\le 0$ or non-integer     | Returns `422 Unprocessable Entity`; UI prevents decimal inputs and validates positive amounts.                   |
| **3** | Uneven split amounts              | Remainder cents distributed deterministically to first members in addition order (`rowid ASC`).                  |
| **4** | Duplicate payment request         | Identical `Idempotency-Key` returns original payment record with `200 OK` without double-charging.               |
| **5** | Concurrent payments on same share | Atomic conditional SQL update ensures only 1 request succeeds; conflicting request receives `409 Conflict`.      |
| **6** | Bill or share does not exist      | Returns `404 Not Found` with `{ "error": "Bill not found" }` or `{ "error": "Share not found" }`.                |
| **7** | Slow API or 500 error             | UI catches errors gracefully, displays dismissible alerts with a retry action, and preserves unpaid share state. |

---

## What we look at

- **Your code passes the tests.** The tests decide, not opinion. You get the visible tests. We also run extra tests that you do not see.
- **Your code is safe when things go wrong.** Wrong input, repeated requests, and two requests at the same time must not break your data.
- **Your code is typed.** Use TypeScript. Do not use `any`.
- **You understand your code.** You record a short video and explain it.

Take your time. A careful, correct solution is better than a fast one. We expect 2 to 3 days of real work.

## Stack (required)

- **API:** Hono on Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite). The binding is `DB` in `api/wrangler.jsonc`.
- **Web:** React, Vite, TanStack Router
- **Language:** TypeScript on both sides
- **Tests:** Vitest, running inside the Workers runtime
- **Quality:** Biome. `pnpm check` and `pnpm typecheck` must pass.

You choose the rest (styling, form library, validation library). Pick tools you can explain.

## The task

The assignment has two parts. Do Part 1 first. Part 2 builds on it.

**Database.** Write the schema as SQL migration files in `api/migrations/`. For example `0001_init.sql`. The tests apply every file in this folder. Your schema must have **at least 3 named constraints** that protect the data. For example a foreign key, a `CHECK`, or a `UNIQUE` key. Be ready to explain what each constraint stops.

**Errors.** Every error response is JSON: `{ "error": "message" }`.

## Part 1: Homes and members

Create a home and add members to it. The order in which members are added matters in Part 2.

#### `POST /api/homes`

- Request: `{ "name": string }`
- Success: `201` `{ id, name }`

#### `POST /api/homes/:homeId/members`

- Request: `{ "name": string }`
- Success: `201` `{ id, homeId, name }`
- Errors: `404` home not found

Visible tests: `api/test/homes.test.ts`.

## Part 2: Bill splitting

Add a bill to a home, split it between the members, and let each member pay their share.

All amounts are whole **cents** (integers). `100` cents is 1 dollar. Never use decimals for money.

#### `POST /api/homes/:homeId/bills`

- Request: `{ "title": string, "totalCents": number }`
- Success: `201` `{ id, homeId, title, totalCents, shares: [{ id, memberId, amountCents, paidAt: null }] }`
- Errors: `404` home not found. `422` total is not a positive whole number, or the home has no members.

#### `POST /api/bills/:billId/shares/:shareId/pay`

- Request: header `Idempotency-Key`
- Success: `200` `{ id, memberId, amountCents, paidAt }`
- Errors: `400` key missing. `404` bill or share not found. `409` share already paid with a different key.

#### `GET /api/homes/:homeId/balances`

- Success: `200` `{ balances: [{ memberId, name, outstandingCents }] }`
- Errors: `404` home not found

**Rules**

- **Split.** A bill is split between all members of the home. The shares always add up to `totalCents`. If the amount does not divide evenly, the extra cents go to the members one by one, in the order the members were added to the home. Example: 1000 cents between 3 members gives `334`, `333`, `333`.
- **Pay.** Paying marks one share as paid and sets `paidAt`. If the same `Idempotency-Key` is sent again for the same share, answer `200` with the same result. Do not pay twice. If two requests pay the same share at the same time, only one may succeed.
- **Balances.** `outstandingCents` is the sum of the member's unpaid shares, across all bills of the home. List the members in the order they were added.

Visible tests: `api/test/bills.test.ts` and `api/test/payments.test.ts`.

#### Web page

Build one page that:

- shows the bills of a home and the shares of each bill,
- lets a member pay a share,
- shows clear **loading**, **empty**, and **error** states,
- keeps the share unpaid and shows an error if the payment fails.

The page must not crash when the API answers with an error or is slow.

## Cases you must handle

You must handle these cases and talk about them in your video:

1. A home with no members.
2. An amount that is zero, negative, or not a whole number.
3. An amount that does not divide evenly.
4. The same payment request sent twice.
5. Two members paying the same share at the same time.
6. A bill or share that does not exist.
7. The API answers with a 500 error or is slow. The web page must not crash.

## Run it

This is a pnpm workspace. Install once at the root.

```bash
pnpm install
pnpm dev          # api on :8787 and web on :5173
```

Open http://localhost:5173. The starter page shows a title. `/api/health` returns `{ "status": "ok" }`.

```bash
pnpm test         # run the visible tests in api/test
pnpm check        # Biome: format and lint. Must pass.
pnpm check:fix    # fix what Biome can fix
pnpm typecheck    # tsc on both packages. Must pass.
pnpm build        # production build of the web app
```

`pnpm dev` applies your migrations to a local database before it starts the API.

If pnpm says some build scripts were ignored, run `pnpm approve-builds` and allow `esbuild` and `workerd`.

When you change `api/wrangler.jsonc`, refresh the `Env` types:

```bash
pnpm --filter bill-splitter-api cf-typegen
```

## Rules for the tests

- The visible tests are in `api/test`. They start with a failing result. Your job is to make them pass.
- Do **not** change the visible tests or `api/test/helpers.ts`. We compare them with the original.
- We run extra tests after you submit. They test the cases in "Cases you must handle" more closely.

## AI policy

You can use AI tools. Tell us which ones and where in your answers on the form.
You must understand every line you submit. We check this with your video and in a live call. "The AI wrote it" is not an answer.

## Decisions

> [!IMPORTANT]
> Below are the 3 core engineering decisions and architectural trade-offs made in this project:

### 1. Defensive Database Constraints for Financial Integrity

- **What:** Enforced financial and referential integrity directly at the SQLite D1 layer using named constraints: `fk_members_home`, `chk_bills_total_positive`, `chk_shares_amount_positive`, `uq_shares_idempotency_key`, `fk_bills_home`, `fk_shares_bill`, and `fk_shares_member`.
- **Why & Trade-off:** While payload checks exist in Hono route handlers, application-level validation can be bypassed by concurrent race conditions or future refactors. Placing constraints at the database engine level ensures that corrupt financial records, zero/negative balances, or orphaned splits are physically impossible to persist.

### 2. Atomic Concurrency Control & Idempotency for Payments

- **What:** Concurrency safety and idempotency are handled through an atomic conditional update:

  ```sql
  UPDATE shares
  SET paid_at = ?, idempotency_key = ?
  WHERE id = ? AND bill_id = ? AND paid_at IS NULL
  ```

  paired with a unique constraint on `idempotency_key`.
- **Why & Trade-off:** We avoided external distributed locks, which introduce latency, failure modes, and deadlock risks. When two simultaneous payment requests arrive for the same share, the database engine executes the update atomically: exactly one request succeeds (`changes === 1`), while the concurrent request fails and returns `409 Conflict`. Re-transmitting the identical `Idempotency-Key` detects the existing payment and idempotently returns `200 OK` with the original timestamp.

### 3. Deterministic Member-Order Splitting & Correlated Balance Aggregation

- **What:** Remainder cents from uneven splits are distributed to members strictly in their sequence of joining (`ORDER BY rowid ASC`). For balance reporting, individual debts are computed via correlated scalar subqueries:

  ```sql
  SELECT m.id AS memberId, m.name,
    COALESCE((
      SELECT SUM(s.amount_cents)
      FROM shares s
      JOIN bills b ON s.bill_id = b.id
      WHERE s.member_id = m.id AND b.home_id = m.home_id AND s.paid_at IS NULL
    ), 0) AS outstandingCents
  FROM members m WHERE m.home_id = ? ORDER BY m.rowid ASC;
  ```
- **Why & Trade-off:** Multi-table `LEFT JOIN` queries with `GROUP BY` across homes, members, bills, and shares create Cartesian duplicate risks and fragile aggregation when homes have multiple bills with partial payments. A correlated subquery isolates the calculation per member, guarantees predictable performance, and cleanly represents members who owe `0` cents.

---

Verification criteria: `pnpm install && pnpm check && pnpm typecheck && pnpm test` (all passing).
