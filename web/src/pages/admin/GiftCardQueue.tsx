import { useEffect, useRef, useState } from "react";
import type { AdminGiftCardSubmission } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import AdminShell from "../../components/AdminShell";

/** Mirrors the server's rule: payout = redeemed value x rate, rounded DOWN to the cent. */
function previewPayout(redeemed: string, rate: string): string | null {
  const v = Number(redeemed);
  if (!Number.isFinite(v) || v <= 0) return null;
  return (Math.floor(v * Number(rate) * 100 + 1e-9) / 100).toFixed(2);
}

function autoPaymentSummary(s: AdminGiftCardSubmission): string | null {
  const a = s.auto_payment;
  if (!a) return null;
  if (!a.auto_settled) return a.manual_reason ?? "Auto-payment was off — settle manually.";
  if (a.auto_payout?.status === "sent") return "Credited to the wallet and sent on to their mobile money.";
  if (a.auto_payout && a.auto_payout.reason && a.auto_payout.reason !== "seller has not opted in") {
    return `Credited to the wallet automatically. Not sent to mobile money: ${a.auto_payout.reason}.`;
  }
  return "Credited to the seller's wallet automatically.";
}

export default function AdminGiftCardQueue() {
  const [submissions, setSubmissions] = useState<AdminGiftCardSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("under_review");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoOn, setAutoOn] = useState<boolean | null>(null);

  // Card-code reveal: which card is asking for a 2FA code, and the code currently on screen (auto-hides).
  const [revealAskId, setRevealAskId] = useState<string | null>(null);
  const [revealOtp, setRevealOtp] = useState("");
  const [revealed, setRevealed] = useState<{ id: string; code: string; left: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (hideTimer.current) clearInterval(hideTimer.current);
    hideTimer.current = null;
  };
  // Never leave a code on screen after navigating away.
  useEffect(() => stopTimer, []);

  const reveal = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const r = await easex.admin.giftcards.revealCode(id, revealOtp.trim());
      setRevealAskId(null);
      setRevealOtp("");
      setRevealed({ id, code: r.code, left: r.hide_after_seconds });
      stopTimer();
      hideTimer.current = setInterval(() => {
        setRevealed((cur) => {
          if (!cur || cur.left <= 1) {
            stopTimer();
            return null;
          }
          return { ...cur, left: cur.left - 1 };
        });
      }, 1000);
      load(); // refreshes the reveal count
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't reveal the code."));
    } finally {
      setBusyId(null);
    }
  };

  // which card has its approve form open, and what's typed in it
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState("");
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const load = () => {
    setLoading(true);
    easex.admin.giftcards
      .list({ status: statusFilter || undefined })
      .then(setSubmissions)
      .catch(() => setError("Couldn't load submissions."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter]);
  useEffect(() => {
    easex.admin.dashboard().then((d) => setAutoOn(d.giftcard_auto_payment_enabled)).catch(() => {});
  }, []);

  const runAction = async (fn: () => Promise<unknown>, id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      setApprovingId(null);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "Action failed — please try again."));
    } finally {
      setBusyId(null);
    }
  };

  const openApprove = (s: AdminGiftCardSubmission) => {
    setApprovingId(s.id);
    setRedeemed(s.face_value);
    setReference("");
    setConfirmed(false);
    setError(null);
  };

  return (
    <AdminShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22 }}>Gift card review</h1>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="admin-select">
          <option value="under_review">Under review</option>
          <option value="verified">Approved — awaiting settlement</option>
          <option value="settled">Settled</option>
          <option value="rejected">Rejected</option>
          <option value="flagged">Flagged</option>
          <option value="">All</option>
        </select>
      </div>

      {autoOn !== null && (
        <p className="hint" style={{ margin: "0 0 16px" }}>
          {autoOn
            ? "Auto-payment is ON: approving a card credits the seller's wallet immediately (and pays out to mobile money for sellers who opted in)."
            : "Auto-payment is OFF: after approving, use “Settle” to pay the seller."}
        </p>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : submissions.length === 0 ? (
        <p style={{ color: "var(--ink-soft)" }}>Nothing here.</p>
      ) : (
        <div className="admin-card-list">
          {submissions.map((s) => {
            const payout = previewPayout(redeemed, s.offered_rate);
            const summary = autoPaymentSummary(s);
            return (
              <div key={s.id} className="admin-review-card">
                <div className="admin-review-header">
                  <div>
                    <strong>{s.brand_name}{s.subcategory_name ? ` — ${s.subcategory_name}` : ""}</strong>
                    <span className="admin-review-sub">{s.username} · {s.email}</span>
                  </div>
                  <span className={`status-pill status-${s.transaction_status}`}>{s.transaction_status}</span>
                </div>

                <div className="admin-review-body">
                  <div className="admin-review-field">
                    <span className="admin-review-field-label">Declared value</span>
                    <span>{s.face_value} {s.card_currency}</span>
                  </div>
                  <div className="admin-review-field">
                    <span className="admin-review-field-label">Rate</span>
                    <span>GHS {Number(s.offered_rate)} per 1 {s.card_currency}</span>
                  </div>
                  {s.redeemed_value && (
                    <div className="admin-review-field">
                      <span className="admin-review-field-label">Redeemed</span>
                      <span>{s.redeemed_value} {s.card_currency}{s.redemption_reference ? ` · ${s.redemption_reference}` : ""}</span>
                    </div>
                  )}
                  {s.verified_value && (
                    <div className="admin-review-field">
                      <span className="admin-review-field-label">Payout amount</span>
                      <span>GHS {s.verified_value}</span>
                    </div>
                  )}
                </div>

                {s.card_image && (
                  <div className="admin-review-images">
                    <a href={s.card_image} target="_blank" rel="noreferrer">
                      <img src={s.card_image} alt="Card photo" className="admin-review-image" />
                    </a>
                  </div>
                )}

                {s.subcategory_help && <p className="hint" style={{ margin: "8px 0 0" }}>{s.subcategory_help}</p>}

                {s.code_available && (s.transaction_status === "under_review" || s.transaction_status === "flagged") && (
                  <div className="admin-approve-form">
                    {revealed?.id === s.id ? (
                      <>
                        <div className="copy-box" style={{ userSelect: "all" }}>{revealed.code}</div>
                        <p className="hint" style={{ margin: 0 }}>Hides in {revealed.left}s. This view was logged.</p>
                      </>
                    ) : revealAskId === s.id ? (
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label htmlFor={`ro-${s.id}`}>Fresh authenticator code</label>
                        <input id={`ro-${s.id}`} inputMode="numeric" maxLength={6} value={revealOtp} onChange={(e) => setRevealOtp(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" autoFocus />
                        <div className="admin-review-actions">
                          <button className="btn-primary" disabled={busyId === s.id || revealOtp.length !== 6} onClick={() => reveal(s.id)}>Reveal</button>
                          <button className="btn-secondary" onClick={() => { setRevealAskId(null); setRevealOtp(""); }}>Cancel</button>
                        </div>
                        <p className="hint">If you just signed in, wait for the next code — each code works once.</p>
                      </div>
                    ) : (
                      <button className="btn-secondary" onClick={() => { setRevealAskId(s.id); setRevealOtp(""); setError(null); }}>
                        Reveal card code{s.code_reveal_count ? ` (viewed ${s.code_reveal_count}×)` : ""}
                      </button>
                    )}
                  </div>
                )}
                {s.reviewer_notes && <p className="admin-review-rejection">Notes: {s.reviewer_notes}</p>}
                {summary && <p className="hint" style={{ margin: "8px 0 0" }}>{summary}</p>}

                {s.transaction_status === "under_review" && approvingId !== s.id && (
                  <div className="admin-review-actions">
                    <button className="btn-primary" onClick={() => openApprove(s)} disabled={busyId === s.id}>Approve…</button>
                    <button className="btn-secondary admin-reject-btn" onClick={() => runAction(() => easex.admin.giftcards.reject(s.id), s.id)} disabled={busyId === s.id}>Reject</button>
                    <button className="btn-secondary" onClick={() => runAction(() => easex.admin.giftcards.flag(s.id, "Flagged for compliance review"), s.id)} disabled={busyId === s.id}>Flag</button>
                  </div>
                )}

                {approvingId === s.id && (
                  <div className="admin-approve-form">
                    <div className="field">
                      <label htmlFor={`rv-${s.id}`}>Amount actually redeemed from the card ({s.card_currency})</label>
                      <input id={`rv-${s.id}`} value={redeemed} onChange={(e) => setRedeemed(e.target.value)} inputMode="decimal" />
                    </div>
                    <div className="field">
                      <label htmlFor={`rf-${s.id}`}>Redemption reference (order / receipt no.)</label>
                      <input id={`rf-${s.id}`} value={reference} onChange={(e) => setReference(e.target.value)} />
                    </div>
                    <label className="check-row">
                      <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                      <span>I have redeemed this card and the amount above is what it was worth.</span>
                    </label>
                    <p className="hint" style={{ margin: "0 0 12px" }}>
                      {payout ? <>Seller will be paid <strong>GHS {payout}</strong>{autoOn ? " — immediately." : " once you settle."}</> : "Enter the redeemed amount."}
                    </p>
                    <div className="admin-review-actions">
                      <button
                        className="btn-primary"
                        disabled={busyId === s.id || !confirmed || !payout}
                        onClick={() =>
                          runAction(
                            () => easex.admin.giftcards.approve(s.id, { redeemed_confirmed: true, redeemed_value: redeemed.trim(), redemption_reference: reference.trim() }),
                            s.id
                          )
                        }
                      >
                        Approve{autoOn ? " & pay" : ""}
                      </button>
                      <button className="btn-secondary" onClick={() => setApprovingId(null)}>Cancel</button>
                    </div>
                  </div>
                )}

                {s.transaction_status === "verified" && (
                  <div className="admin-review-actions">
                    <button className="btn-primary" onClick={() => runAction(() => easex.admin.transactions.settle(s.transaction), s.id)} disabled={busyId === s.id}>
                      Settle — credit seller's wallet
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
