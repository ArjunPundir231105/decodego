import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

type HomeItem = {
  id: string
  name: string
  created_at?: string
}

type MemberItem = {
  id: string
  home_id: string
  name: string
}

type ShareItem = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}

type BillItem = {
  id: string
  homeId: string
  title: string
  totalCents: number
  createdAt: string
  shares: ShareItem[]
}

type BalanceItem = {
  memberId: string
  name: string
  outstandingCents: number
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function Dashboard() {
  const [homes, setHomes] = useState<HomeItem[]>([])
  const [selectedHomeId, setSelectedHomeId] = useState<string>('')
  const [members, setMembers] = useState<MemberItem[]>([])
  const [bills, setBills] = useState<BillItem[]>([])
  const [balances, setBalances] = useState<BalanceItem[]>([])

  // UI state
  const [loading, setLoading] = useState<boolean>(true)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [payingShareId, setPayingShareId] = useState<string | null>(null)

  // Modals / forms
  const [showNewHome, setShowNewHome] = useState(false)
  const [newHomeName, setNewHomeName] = useState('')
  const [showNewMember, setShowNewMember] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [showNewBill, setShowNewBill] = useState(false)
  const [newBillTitle, setNewBillTitle] = useState('')
  const [newBillAmount, setNewBillAmount] = useState('')
  const [billFormError, setBillFormError] = useState<string | null>(null)

  // Fetch homes list
  const loadHomes = useCallback(async () => {
    try {
      const res = await fetch('/api/homes')
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load homes`)
      const data = (await res.json()) as { homes: HomeItem[] }
      setHomes(data.homes || [])
      if (data.homes && data.homes.length > 0 && !selectedHomeId) {
        setSelectedHomeId(data.homes[0]?.id || '')
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to connect to API')
    }
  }, [selectedHomeId])

  // Fetch home details, bills, balances
  const loadHomeDetails = useCallback(async (homeId: string) => {
    if (!homeId) return
    setLoading(true)
    setGlobalError(null)

    try {
      // Fetch home members
      const homeRes = await fetch(`/api/homes/${homeId}`)
      if (!homeRes.ok) throw new Error(`HTTP ${homeRes.status}: Failed to load home details`)
      const homeData = (await homeRes.json()) as { id: string; name: string; members: MemberItem[] }
      setMembers(homeData.members || [])

      // Fetch bills
      const billsRes = await fetch(`/api/homes/${homeId}/bills`)
      if (!billsRes.ok) throw new Error(`HTTP ${billsRes.status}: Failed to load bills`)
      const billsData = (await billsRes.json()) as { bills: BillItem[] }
      setBills(billsData.bills || [])

      // Fetch balances
      const balancesRes = await fetch(`/api/homes/${homeId}/balances`)
      if (!balancesRes.ok) throw new Error(`HTTP ${balancesRes.status}: Failed to load balances`)
      const balancesData = (await balancesRes.json()) as { balances: BalanceItem[] }
      setBalances(balancesData.balances || [])
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Error fetching home data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHomes()
  }, [loadHomes])

  useEffect(() => {
    if (selectedHomeId) {
      loadHomeDetails(selectedHomeId)
    } else {
      setLoading(false)
    }
  }, [selectedHomeId, loadHomeDetails])

  // Handle Home creation
  async function handleCreateHome(e: React.FormEvent) {
    e.preventDefault()
    if (!newHomeName.trim()) return
    setActionError(null)

    try {
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newHomeName.trim() }),
      })
      const data = (await res.json()) as { id?: string; error?: string }
      if (!res.ok || !data.id) {
        throw new Error(data.error || 'Failed to create home')
      }
      setNewHomeName('')
      setShowNewHome(false)
      await loadHomes()
      setSelectedHomeId(data.id)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create home')
    }
  }

  // Handle Member creation
  async function handleCreateMember(e: React.FormEvent) {
    e.preventDefault()
    if (!newMemberName.trim() || !selectedHomeId) return
    setActionError(null)

    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim() }),
      })
      const data = (await res.json()) as { id?: string; error?: string }
      if (!res.ok || !data.id) {
        throw new Error(data.error || 'Failed to add member')
      }
      setNewMemberName('')
      setShowNewMember(false)
      await loadHomeDetails(selectedHomeId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to add member')
    }
  }

  // Handle Bill creation with input validation
  async function handleCreateBill(e: React.FormEvent) {
    e.preventDefault()
    setBillFormError(null)

    if (members.length === 0) {
      setBillFormError('Cannot create a bill: home has no members.')
      return
    }

    const title = newBillTitle.trim() || 'Shared Bill'
    const parsedAmount = Number.parseFloat(newBillAmount)

    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setBillFormError('Please enter a valid positive dollar amount.')
      return
    }

    // Convert dollar to exact integer cents
    const totalCents = Math.round(parsedAmount * 100)
    if (totalCents <= 0) {
      setBillFormError('Amount must be at least 1 cent.')
      return
    }

    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, totalCents }),
      })
      const data = (await res.json()) as { id?: string; error?: string }
      if (!res.ok || !data.id) {
        throw new Error(data.error || 'Failed to create bill')
      }
      setNewBillTitle('')
      setNewBillAmount('')
      setShowNewBill(false)
      await loadHomeDetails(selectedHomeId)
    } catch (err) {
      setBillFormError(err instanceof Error ? err.message : 'Failed to create bill')
    }
  }

  // Handle Share payment with Idempotency Key & Error Protection
  async function handlePayShare(billId: string, shareId: string) {
    setPayingShareId(shareId)
    setActionError(null)

    // Defensive idempotency key generation
    const idempotencyKey = crypto.randomUUID()

    try {
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      })

      const data = (await res.json()) as { id?: string; paidAt?: string; error?: string }

      if (!res.ok) {
        // Keeps the share unpaid and displays the error
        throw new Error(data.error || `Payment failed (Status ${res.status})`)
      }

      // Optimistically or explicitly update the share to paid
      setBills((prevBills) =>
        prevBills.map((bill) => {
          if (bill.id !== billId) return bill
          return {
            ...bill,
            shares: bill.shares.map((share) => {
              if (share.id !== shareId) return share
              return { ...share, paidAt: data.paidAt || new Date().toISOString() }
            }),
          }
        }),
      )

      // Refresh balances in the background
      const balancesRes = await fetch(`/api/homes/${selectedHomeId}/balances`)
      if (balancesRes.ok) {
        const balancesData = (await balancesRes.json()) as { balances: BalanceItem[] }
        setBalances(balancesData.balances || [])
      }
    } catch (err) {
      // Crucial requirement: Share remains unpaid and error is clearly presented
      setActionError(err instanceof Error ? err.message : 'Payment request failed')
    } finally {
      setPayingShareId(null)
    }
  }

  const currentHome = homes.find((h) => h.id === selectedHomeId)

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">➗</div>
          <div>
            <h1 className="brand-title">Divido</h1>
            <p className="brand-subtitle">Shared Home Bill Splitter</p>
          </div>
        </div>

        <div className="header-actions">
          {homes.length > 0 && (
            <select
              className="home-select"
              value={selectedHomeId}
              onChange={(e) => setSelectedHomeId(e.target.value)}
            >
              {homes.map((h) => (
                <option key={h.id} value={h.id}>
                  🏠 {h.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowNewHome(!showNewHome)}
          >
            + New Home
          </button>

          {selectedHomeId && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowNewMember(!showNewMember)}
              >
                + Add Member
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowNewBill(!showNewBill)}
              >
                + Split Bill
              </button>
            </>
          )}
        </div>
      </header>

      {/* Global / Action Alerts */}
      {globalError && (
        <div className="alert alert-danger">
          <span>⚠️ {globalError}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => (selectedHomeId ? loadHomeDetails(selectedHomeId) : loadHomes())}
          >
            Retry
          </button>
        </div>
      )}

      {actionError && (
        <div className="alert alert-danger">
          <span>❌ {actionError}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setActionError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Inline Form: Create Home */}
      {showNewHome && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 className="card-title">Create a New Home</h2>
          <form
            onSubmit={handleCreateHome}
            style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}
          >
            <div className="form-group" style={{ flex: 1, margin: 0 }}>
              <label className="form-label" htmlFor="new-home-name">
                Home Name
              </label>
              <input
                id="new-home-name"
                className="form-input"
                type="text"
                placeholder="e.g. Flat 4B, Baker St."
                value={newHomeName}
                onChange={(e) => setNewHomeName(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Create Home
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowNewHome(false)}
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {/* Inline Form: Add Member */}
      {showNewMember && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 className="card-title">Add Member to {currentHome?.name}</h2>
          <form
            onSubmit={handleCreateMember}
            style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}
          >
            <div className="form-group" style={{ flex: 1, margin: 0 }}>
              <label className="form-label" htmlFor="new-member-name">
                Member Name
              </label>
              <input
                id="new-member-name"
                className="form-input"
                type="text"
                placeholder="e.g. Asha, Ben, Chitra"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Add Member
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowNewMember(false)}
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {/* Inline Form: Create Bill */}
      {showNewBill && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 className="card-title">Split a New Bill</h2>
          {billFormError && (
            <div className="alert alert-danger" style={{ margin: '8px 0 16px 0' }}>
              ⚠️ {billFormError}
            </div>
          )}
          <form onSubmit={handleCreateBill}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="bill-title">
                  Bill Title
                </label>
                <input
                  id="bill-title"
                  className="form-input"
                  type="text"
                  placeholder="e.g. Electricity, Groceries"
                  value={newBillTitle}
                  onChange={(e) => setNewBillTitle(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="bill-amount">
                  Total Amount ($)
                </label>
                <input
                  id="bill-amount"
                  className="form-input"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 10.00"
                  value={newBillAmount}
                  onChange={(e) => setNewBillAmount(e.target.value)}
                  required
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={members.length === 0}>
                Split Among {members.length} Members
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowNewBill(false)
                  setBillFormError(null)
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="grid-cols-2">
          <div className="card">
            <div className="skeleton" style={{ height: 28, width: 140, marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 100, marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 100 }} />
          </div>
          <div className="card">
            <div className="skeleton" style={{ height: 28, width: 120, marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 50, marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 50 }} />
          </div>
        </div>
      ) : homes.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">🏘️</div>
          <h2 className="empty-state-title">No homes created yet</h2>
          <p className="empty-state-desc">
            Get started by creating your first shared home and adding members.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => setShowNewHome(true)}
          >
            Create Your First Home
          </button>
        </div>
      ) : (
        <div className="grid-cols-2">
          {/* Left Column: Bills & Shares */}
          <div>
            <div className="card">
              <h2 className="card-title">
                <span>Bills & Splits</span>
                <span className="badge badge-warning">{bills.length} bills</span>
              </h2>

              {members.length === 0 && (
                <div className="alert alert-warning">
                  <span>⚠️ This home has no members yet. Add members to enable bill splitting.</span>
                </div>
              )}

              {bills.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🧾</div>
                  <h3 className="empty-state-title">No bills yet</h3>
                  <p className="empty-state-desc">
                    {members.length === 0
                      ? 'Add members to this home first, then add bills to split.'
                      : 'Split rent, electricity, or groceries among all housemates.'}
                  </p>
                </div>
              ) : (
                bills.map((bill) => (
                  <div key={bill.id} className="card bill-card">
                    <div className="bill-header">
                      <div>
                        <div className="bill-title">{bill.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                          {new Date(bill.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </div>
                      </div>
                      <div className="bill-total">{formatCents(bill.totalCents)}</div>
                    </div>

                    <div className="shares-list">
                      {bill.shares.map((share) => {
                        const isPaying = payingShareId === share.id
                        const isPaid = share.paidAt !== null

                        return (
                          <div key={share.id} className="share-row">
                            <div className="share-info">
                              <div className="share-avatar">
                                {(share.memberName || 'M')[0]?.toUpperCase()}
                              </div>
                              <div>
                                <div style={{ fontSize: 14, fontWeight: 500 }}>
                                  {share.memberName}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  {isPaid ? (
                                    <span style={{ color: 'var(--status-success)' }}>
                                      Paid on{' '}
                                      {new Date(share.paidAt as string).toLocaleDateString()}
                                    </span>
                                  ) : (
                                    <span style={{ color: 'var(--status-warning)' }}>
                                      Unpaid share
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span className="share-amount">{formatCents(share.amountCents)}</span>

                              {isPaid ? (
                                <span className="badge badge-success">✓ Paid</span>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={isPaying}
                                  onClick={() => handlePayShare(bill.id, share.id)}
                                >
                                  {isPaying ? 'Processing...' : 'Pay Share'}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Column: Balances & Members */}
          <div>
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 className="card-title">
                <span>Outstanding Balances</span>
              </h2>

              {balances.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No members added yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {balances.map((b) => (
                    <div
                      key={b.memberId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 12px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="share-avatar">{b.name[0]?.toUpperCase()}</div>
                        <span style={{ fontWeight: 500, fontSize: 14 }}>{b.name}</span>
                      </div>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          color: b.outstandingCents > 0 ? '#fbbf24' : '#34d399',
                        }}
                      >
                        {formatCents(b.outstandingCents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="card-title">
                <span>House Members ({members.length})</span>
              </h2>

              {members.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  No members in this home. Click "+ Add Member" above.
                </p>
              ) : (
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {members.map((m, idx) => (
                    <li
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 13,
                        color: 'var(--text-muted)',
                      }}
                    >
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: 'rgba(255, 255, 255, 0.08)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {idx + 1}
                      </span>
                      <strong style={{ color: 'var(--text-main)' }}>{m.name}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
