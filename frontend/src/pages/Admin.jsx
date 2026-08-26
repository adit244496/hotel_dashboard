import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Hint } from '../components/common'

const BLANK_HOTEL = { code: '', name: '', entity_code: '', room_inventory: 0, sort_order: 0 }

/** One hotel row: read-only, or an inline edit form when it is being edited. */
function HotelRow({ hotel, editing, onEdit, onCancel, onSave, onToggle, onDelete, busy }) {
  const [draft, setDraft] = useState(hotel)

  useEffect(() => setDraft(hotel), [hotel, editing])

  const set = (field) => (e) => setDraft({ ...draft, [field]: e.target.value })

  if (!editing) {
    return (
      <tr>
        <td>
          <b>{hotel.code}</b>
        </td>
        <td>{hotel.name}</td>
        <td className="muted">{hotel.entity_code || '—'}</td>
        <td className="num">{hotel.room_inventory}</td>
        <td className="num muted">{hotel.sort_order}</td>
        <td>
          <span className={`status-pill ${hotel.is_active ? 'status-committed' : 'status-superseded'}`}>
            {hotel.is_active ? 'active' : 'inactive'}
          </span>
        </td>
        <td>
          <div className="row-actions">
            <button className="btn small ghost" onClick={onEdit} disabled={busy}>
              Edit
            </button>
            <button className="btn small ghost" onClick={onToggle} disabled={busy}>
              {hotel.is_active ? 'Deactivate' : 'Activate'}
            </button>
            <button className="btn small danger" onClick={onDelete} disabled={busy}>
              Delete
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="editing">
      <td>
        <input className="cell-input code" value={draft.code} onChange={set('code')} maxLength={16} />
      </td>
      <td>
        <input className="cell-input wide" value={draft.name} onChange={set('name')} />
      </td>
      <td>
        <input
          className="cell-input"
          value={draft.entity_code || ''}
          onChange={set('entity_code')}
          placeholder="E_4013"
        />
      </td>
      <td className="num">
        <input
          className="cell-input tiny"
          type="number"
          min={0}
          value={draft.room_inventory}
          onChange={set('room_inventory')}
        />
      </td>
      <td className="num">
        <input
          className="cell-input tiny"
          type="number"
          value={draft.sort_order}
          onChange={set('sort_order')}
        />
      </td>
      <td className="muted">—</td>
      <td>
        <div className="row-actions">
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              onSave({
                code: draft.code.trim().toUpperCase(),
                name: draft.name.trim(),
                entity_code: (draft.entity_code || '').trim() || null,
                room_inventory: Number(draft.room_inventory) || 0,
                sort_order: Number(draft.sort_order) || 0,
              })
            }
          >
            Save
          </button>
          <button className="btn small ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </td>
    </tr>
  )
}

/** Confirmation for a delete that would take reported figures with it. */
function DeleteDialog({ hotel, usage, onCancel, onConfirm, busy }) {
  const [typed, setTyped] = useState('')
  const needsTyping = !usage.can_delete_cleanly
  const ready = !needsTyping || typed.trim().toUpperCase() === hotel.code

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>Delete {hotel.code}?</h3>
        {usage.can_delete_cleanly ? (
          <p className="modal-body">
            {hotel.name} has no uploads or reported figures, so nothing else is
            affected.
          </p>
        ) : (
          <>
            <div className="alert warn">
              This will permanently delete <b>{usage.uploads} upload(s)</b> and the
              figures for <b>{usage.months} month(s)</b> ({usage.period_facts} rows).
              The dashboard will lose this hotel's history.
            </div>
            <p className="modal-body">
              To keep the history but hide the hotel, cancel and use{' '}
              <b>Deactivate</b> instead.
            </p>
            <div className="field">
              <label>Type {hotel.code} to confirm</label>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={hotel.code}
                autoFocus
              />
            </div>
          </>
        )}
        <div className="actions-row">
          <button
            className="btn danger"
            disabled={!ready || busy}
            onClick={() => onConfirm(!usage.can_delete_cleanly)}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Admin() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [hotels, setHotels] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [deleting, setDeleting] = useState(null) // { hotel, usage }

  const [newUser, setNewUser] = useState({ email: '', full_name: '', password: '', role: 'user' })
  const [newHotel, setNewHotel] = useState(BLANK_HOTEL)
  const [passwords, setPasswords] = useState({ current: '', next: '' })

  const reload = useCallback(() => {
    api.listUsers().then(setUsers).catch((err) => setError(err.message))
    api
      .hotels({ include_inactive: true })
      .then(setHotels)
      .catch((err) => setError(err.message))
  }, [])

  useEffect(reload, [reload])

  /** Run an admin action, surfacing the result and refreshing. */
  const run = async (fn, successMessage) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      if (successMessage) setNotice(successMessage)
      reload()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const submit = (fn, message) => async (event) => {
    event.preventDefault()
    await run(fn, message)
  }

  const askDelete = async (hotel) => {
    setError('')
    try {
      const usage = await api.hotelUsage(hotel.id)
      setDeleting({ hotel, usage })
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <main className="main">
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      {/* ----------------------------------------------------------- hotels */}
      <div className="panel-card">
        <h2>Hotels &amp; projects</h2>
        <p className="sub">
          Properties shown on the dashboard.
          <Hint>
            The <b>entity code</b> (for example E_4013) is printed at the top of
            each workbook. Setting it lets an upload be matched to the right
            hotel, and warns when a file is uploaded against the wrong one.
            <br />
            <br />
            <b>Deactivate</b> hides a hotel but keeps its history.{' '}
            <b>Delete</b> removes it and its figures for good.
          </Hint>
        </p>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Entity code</th>
                <th className="num">Rooms</th>
                <th className="num">Order</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {hotels.map((hotel) => (
                <HotelRow
                  key={hotel.id}
                  hotel={hotel}
                  editing={editingId === hotel.id}
                  busy={busy}
                  onEdit={() => setEditingId(hotel.id)}
                  onCancel={() => setEditingId(null)}
                  onSave={async (payload) => {
                    const ok = await run(
                      () => api.updateHotel(hotel.id, payload),
                      `Updated ${payload.code}.`
                    )
                    if (ok) setEditingId(null)
                  }}
                  onToggle={() =>
                    run(
                      () => api.updateHotel(hotel.id, { is_active: !hotel.is_active }),
                      `${hotel.code} ${hotel.is_active ? 'deactivated' : 'activated'}.`
                    )
                  }
                  onDelete={() => askDelete(hotel)}
                />
              ))}
              {hotels.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 20 }}>
                    No hotels yet — add one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="sub-head">Add a hotel</div>
        <form
          className="form-row"
          onSubmit={submit(async () => {
            await api.createHotel({
              ...newHotel,
              room_inventory: Number(newHotel.room_inventory) || 0,
              sort_order: Number(newHotel.sort_order) || 0,
              entity_code: newHotel.entity_code || null,
            })
            setNewHotel(BLANK_HOTEL)
          }, 'Hotel added.')}
        >
          <div className="filter">
            <label>Code</label>
            <input
              value={newHotel.code}
              onChange={(e) => setNewHotel({ ...newHotel, code: e.target.value })}
              placeholder="CCNT"
              required
            />
          </div>
          <div className="filter" style={{ flex: 1, minWidth: 220 }}>
            <label>Name</label>
            <input
              value={newHotel.name}
              onChange={(e) => setNewHotel({ ...newHotel, name: e.target.value })}
              placeholder="Taj City Centre New Town"
              required
            />
          </div>
          <div className="filter">
            <label>Entity code</label>
            <input
              value={newHotel.entity_code}
              onChange={(e) => setNewHotel({ ...newHotel, entity_code: e.target.value })}
              placeholder="E_4013"
            />
          </div>
          <div className="filter">
            <label>Rooms</label>
            <input
              type="number"
              min={0}
              value={newHotel.room_inventory}
              onChange={(e) => setNewHotel({ ...newHotel, room_inventory: e.target.value })}
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Add hotel
          </button>
        </form>
      </div>

      {/* ------------------------------------------------------------ users */}
      <div className="panel-card">
        <h2>Users</h2>
        <p className="sub">
          Admins upload and manage; users are read-only.
        </p>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>
                    <b>{item.email}</b>
                  </td>
                  <td>{item.full_name || '—'}</td>
                  <td>{item.role}</td>
                  <td>
                    <span className={`status-pill ${item.is_active ? 'status-committed' : 'status-failed'}`}>
                      {item.is_active ? 'active' : 'disabled'}
                    </span>
                  </td>
                  <td>
                    {item.is_active && item.id !== user.id && (
                      <button
                        className="btn small danger"
                        disabled={busy}
                        onClick={() =>
                          run(() => api.deactivateUser(item.id), `${item.email} disabled.`)
                        }
                      >
                        Disable
                      </button>
                    )}
                    {item.id === user.id && <span className="muted">That's you</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sub-head">Add a user</div>
        <form
          className="form-row"
          onSubmit={submit(async () => {
            await api.createUser(newUser)
            setNewUser({ email: '', full_name: '', password: '', role: 'user' })
          }, 'User created.')}
        >
          <div className="filter" style={{ flex: 1, minWidth: 220 }}>
            <label>Email</label>
            <input
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              required
            />
          </div>
          <div className="filter">
            <label>Full name</label>
            <input
              value={newUser.full_name}
              onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
            />
          </div>
          <div className="filter">
            <label>Password</label>
            <input
              type="password"
              minLength={6}
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              required
            />
          </div>
          <div className="filter">
            <label>Role</label>
            <select
              value={newUser.role}
              onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
            >
              <option value="user">User (read-only)</option>
              <option value="admin">Admin (can upload)</option>
            </select>
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Add user
          </button>
        </form>
      </div>

      {/* ---------------------------------------------------------- account */}
      <div className="panel-card">
        <h2>Your account</h2>
        <p className="sub">
          Signed in as {user.email} ({user.role}).
        </p>
        <form
          className="form-row"
          onSubmit={submit(async () => {
            await api.changePassword(passwords.current, passwords.next)
            setPasswords({ current: '', next: '' })
          }, 'Password updated.')}
        >
          <div className="filter">
            <label>Current password</label>
            <input
              type="password"
              value={passwords.current}
              onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
              required
            />
          </div>
          <div className="filter">
            <label>New password</label>
            <input
              type="password"
              minLength={6}
              value={passwords.next}
              onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
              required
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Change password
          </button>
        </form>
      </div>

      {deleting && (
        <DeleteDialog
          hotel={deleting.hotel}
          usage={deleting.usage}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={async (cascade) => {
            const ok = await run(
              () => api.deleteHotel(deleting.hotel.id, cascade),
              `${deleting.hotel.code} deleted.`
            )
            if (ok) setDeleting(null)
          }}
        />
      )}
    </main>
  )
}
