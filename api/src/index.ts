import { Hono } from 'hono'

type HomeRow = {
  id: string
  name: string
  created_at: string
}

type MemberRow = {
  id: string
  home_id: string
  name: string
  created_at: string
}

type BillRow = {
  id: string
  home_id: string
  title: string
  total_cents: number
  created_at: string
}

type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
  created_at: string
}

type BalanceRow = {
  memberId: string
  name: string
  outstandingCents: number
}

const app = new Hono<{ Bindings: Env }>()

// Health Check
app.get('/api/health', (c) => c.json({ status: 'ok' }))

// List all homes (useful for the web frontend)
app.get('/api/homes', async (c) => {
  const homes = await c.env.DB.prepare(
    'SELECT id, name, created_at FROM homes ORDER BY rowid DESC',
  ).all<HomeRow>()
  return c.json({ homes: homes.results })
})

// Part 1: POST /api/homes
app.post('/api/homes', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('name' in body) ||
    typeof body.name !== 'string'
  ) {
    return c.json({ error: 'Home name is required and must be a string' }, 400)
  }

  const name = body.name.trim()
  if (name.length === 0) {
    return c.json({ error: 'Home name cannot be empty' }, 400)
  }

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  await c.env.DB.prepare('INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)')
    .bind(id, name, createdAt)
    .run()

  return c.json({ id, name }, 201)
})

// Part 1: POST /api/homes/:homeId/members
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('name' in body) ||
    typeof body.name !== 'string'
  ) {
    return c.json({ error: 'Member name is required and must be a string' }, 400)
  }

  const name = body.name.trim()
  if (name.length === 0) {
    return c.json({ error: 'Member name cannot be empty' }, 400)
  }

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, homeId, name, createdAt)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// Fetch single home with members (useful for web frontend)
app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id, name, created_at FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(
    'SELECT id, home_id, name, created_at FROM members WHERE home_id = ? ORDER BY rowid ASC',
  )
    .bind(homeId)
    .all<MemberRow>()

  return c.json({ id: home.id, name: home.name, members: members.results })
})

// Part 2: POST /api/homes/:homeId/bills
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400)
  }

  if (typeof body !== 'object' || body === null) {
    return c.json({ error: 'Invalid request body' }, 422)
  }

  const payload = body as { title?: unknown; totalCents?: unknown }

  if (
    typeof payload.totalCents !== 'number' ||
    !Number.isInteger(payload.totalCents) ||
    payload.totalCents <= 0
  ) {
    return c.json({ error: 'totalCents must be a positive whole integer' }, 422)
  }

  const totalCents = payload.totalCents
  const title =
    typeof payload.title === 'string' && payload.title.trim().length > 0
      ? payload.title.trim()
      : 'Bill'

  // Fetch all members in the exact order they were added to the home
  const membersResult = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY rowid ASC',
  )
    .bind(homeId)
    .all<{ id: string }>()

  const members = membersResult.results
  if (members.length === 0) {
    return c.json({ error: 'Home has no members to split the bill with' }, 422)
  }

  // Splitting algorithm:
  // Base amount = floor(totalCents / N)
  // Remainder = totalCents % N
  // Extra cents go to the first remainder members in order of addition
  const memberCount = members.length
  const baseShare = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  const billId = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  type CreatedShare = {
    id: string
    memberId: string
    amountCents: number
    paidAt: null
  }

  const shares: CreatedShare[] = []
  const shareStatements: D1PreparedStatement[] = []

  for (let i = 0; i < memberCount; i++) {
    const member = members[i]
    if (!member) continue

    const amountCents = baseShare + (i < remainder ? 1 : 0)
    const shareId = crypto.randomUUID()

    shares.push({
      id: shareId,
      memberId: member.id,
      amountCents,
      paidAt: null,
    })

    shareStatements.push(
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)',
      ).bind(shareId, billId, member.id, amountCents, createdAt),
    )
  }

  const billStatement = c.env.DB.prepare(
    'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(billId, homeId, title, totalCents, createdAt)

  await c.env.DB.batch([billStatement, ...shareStatements])

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares,
    },
    201,
  )
})

// Fetch all bills for a home with share details (useful for web frontend)
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const billsResult = await c.env.DB.prepare(
    'SELECT id, home_id, title, total_cents, created_at FROM bills WHERE home_id = ? ORDER BY rowid DESC',
  )
    .bind(homeId)
    .all<BillRow>()

  const bills = billsResult.results
  if (bills.length === 0) {
    return c.json({ bills: [] })
  }

  const billIds = bills.map((b) => b.id)
  const placeholders = billIds.map(() => '?').join(',')

  const sharesResult = await c.env.DB.prepare(`
    SELECT s.id, s.bill_id, s.member_id, s.amount_cents, s.paid_at, m.name as member_name
    FROM shares s
    JOIN members m ON s.member_id = m.id
    WHERE s.bill_id IN (${placeholders})
    ORDER BY s.rowid ASC
  `)
    .bind(...billIds)
    .all<ShareRow & { member_name: string }>()

  const sharesByBill = new Map<
    string,
    Array<{
      id: string
      memberId: string
      memberName: string
      amountCents: number
      paidAt: string | null
    }>
  >()
  for (const s of sharesResult.results) {
    const list = sharesByBill.get(s.bill_id) ?? []
    list.push({
      id: s.id,
      memberId: s.member_id,
      memberName: s.member_name,
      amountCents: s.amount_cents,
      paidAt: s.paid_at,
    })
    sharesByBill.set(s.bill_id, list)
  }

  const detailedBills = bills.map((b) => ({
    id: b.id,
    homeId: b.home_id,
    title: b.title,
    totalCents: b.total_cents,
    createdAt: b.created_at,
    shares: sharesByBill.get(b.id) ?? [],
  }))

  return c.json({ bills: detailedBills })
})

// Part 2: POST /api/bills/:billId/shares/:shareId/pay
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const rawKey = c.req.header('idempotency-key')
  if (!rawKey || rawKey.trim().length === 0) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }
  const idempotencyKey = rawKey.trim()

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?')
    .bind(billId)
    .first<BillRow>()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  // If already marked as paid
  if (share.paid_at !== null) {
    if (share.idempotency_key === idempotencyKey) {
      return c.json(
        {
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        },
        200,
      )
    }
    return c.json({ error: 'Share already paid with a different idempotency key' }, 409)
  }

  // Attempt atomic payment update
  const paidAt = new Date().toISOString()
  try {
    const updateResult = await c.env.DB.prepare(
      'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
    )
      .bind(paidAt, idempotencyKey, shareId, billId)
      .run()

    if (updateResult.meta.changes === 1) {
      return c.json(
        {
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt,
        },
        200,
      )
    }
  } catch {
    // Unique constraint violation or database conflict
  }

  // Concurrent payment race condition occurred; inspect final state
  const latestShare = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ?',
  )
    .bind(shareId)
    .first<ShareRow>()

  if (latestShare && latestShare.paid_at !== null) {
    if (latestShare.idempotency_key === idempotencyKey) {
      return c.json(
        {
          id: latestShare.id,
          memberId: latestShare.member_id,
          amountCents: latestShare.amount_cents,
          paidAt: latestShare.paid_at,
        },
        200,
      )
    }
    return c.json({ error: 'Share already paid with a different idempotency key' }, 409)
  }

  return c.json({ error: 'Could not process payment' }, 500)
})

// Part 2: GET /api/homes/:homeId/balances
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  // Query each member in the exact order they were added,
  // computing their unpaid share sum across all bills belonging to this home
  const result = await c.env.DB.prepare(`
    SELECT
      m.id AS memberId,
      m.name,
      COALESCE(
        (
          SELECT SUM(s.amount_cents)
          FROM shares s
          JOIN bills b ON s.bill_id = b.id
          WHERE s.member_id = m.id
            AND b.home_id = m.home_id
            AND s.paid_at IS NULL
        ),
        0
      ) AS outstandingCents
    FROM members m
    WHERE m.home_id = ?
    ORDER BY m.rowid ASC
  `)
    .bind(homeId)
    .all<BalanceRow>()

  return c.json({ balances: result.results }, 200)
})

export default app
