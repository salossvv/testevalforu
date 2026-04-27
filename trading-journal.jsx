import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "trading-journal-v1";

const defaultRules = {
  environment: "LIVE",
  withdrawals: "Day One",
  profitSplit: "90/10",
  maxAccounts: 5,
  maxWithdrawalAmount: "No Max",
  bufferRequirement: "None",
  dailyLossRule: "None",
  consistencyRule: "None",
  newsRule: "Yes",
  scalingPlan: "None",
};

const initialState = {
  phase: "setup", // setup | eval | funded
  accountSize: 10000,
  profitTarget: 10,
  minTradingDays: 5,
  drawdownType: "End Of Day",
  maxDrawdownPct: 5,
  maxDailyLossPct: 2,
  rules: defaultRules,
  evalTrades: [],
  fundedTrades: [],
  evalStartBalance: 10000,
  fundedStartBalance: 10000,
  evalPassed: false,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...initialState, ...JSON.parse(raw) };
  } catch {}
  return initialState;
}

function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

const fmt = (n) => n >= 0
  ? `+$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : `-$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPct = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

const today = () => new Date().toISOString().split("T")[0];

function getUniqueTradingDays(trades) {
  return new Set(trades.map(t => t.date)).size;
}

function getBalance(startBalance, trades) {
  return trades.reduce((acc, t) => acc + t.pnl, startBalance);
}

function getDrawdownDollar(startBalance, trades) {
  let peak = startBalance;
  let maxDD = 0;
  let running = startBalance;
  for (const t of trades) {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function getDrawdown(startBalance, trades) {
  let peak = startBalance;
  let maxDD = 0;
  let running = startBalance;
  for (const t of trades) {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = ((peak - running) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function getDailyPnl(trades) {
  const byDay = {};
  for (const t of trades) {
    byDay[t.date] = (byDay[t.date] || 0) + t.pnl;
  }
  return byDay;
}

function getWorstDayLoss(trades) {
  const byDay = {};
  for (const t of trades) byDay[t.date] = (byDay[t.date] || 0) + t.pnl;
  return Math.abs(Math.min(0, ...Object.values(byDay)));
}

export default function App() {
  const [state, setState] = useState(loadState);
  const [view, setView] = useState("dashboard"); // dashboard | log | history | rules
  const [tradeForm, setTradeForm] = useState({ pair: "", pnl: "", notes: "", date: today(), session: "New York" });
  const [formError, setFormError] = useState("");
  const [showPassModal, setShowPassModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [setupStep, setSetupStep] = useState(0);

  useEffect(() => { saveState(state); }, [state]);

  const currentTrades = state.phase === "funded" ? state.fundedTrades : state.evalTrades;
  const startBalance = state.phase === "funded" ? state.fundedStartBalance : state.evalStartBalance;
  const balance = getBalance(startBalance, currentTrades);
  const pnl = balance - startBalance;
  const pnlPct = (pnl / startBalance) * 100;
  const drawdown = getDrawdown(startBalance, currentTrades);
  const drawdownDollar = getDrawdownDollar(startBalance, currentTrades);
  const maxDrawdownAmt = state.maxDrawdownAmt || 2000;
  const maxDailyLossAmt = startBalance * ((state.maxDailyLossPct || 2) / 100);
  const worstDayLoss = getWorstDayLoss(currentTrades);
  const dailyPnl = getDailyPnl(currentTrades);
  const todayPnl = dailyPnl[today()] || 0;

  const blownByDrawdown = drawdownDollar >= maxDrawdownAmt;
  const blownByDailyLoss = worstDayLoss >= maxDailyLossAmt && state.maxDailyLossPct > 0;
  const isBlown = blownByDrawdown || blownByDailyLoss;
  const blownReason = blownByDrawdown ? `Max drawdown of $${maxDrawdownAmt.toLocaleString()} exceeded` : `Daily loss limit of $${maxDailyLossAmt.toFixed(0)} exceeded`;

  const tradingDays = getUniqueTradingDays(currentTrades);
  const profitTargetAmt = startBalance * (state.profitTarget / 100);
  const profitProgress = Math.min((pnl / profitTargetAmt) * 100, 100);
  const daysProgress = Math.min((tradingDays / state.minTradingDays) * 100, 100);
  const evalPassed = state.phase === "eval" && pnl >= profitTargetAmt && tradingDays >= state.minTradingDays && !isBlown;

  const logTrade = () => {
    const pnlNum = parseFloat(tradeForm.pnl);
    if (!tradeForm.pair) return setFormError("Enter a trading pair");
    if (isNaN(pnlNum)) return setFormError("Enter a valid P&L amount");
    setFormError("");
    const trade = { id: Date.now(), pair: tradeForm.pair.toUpperCase(), pnl: pnlNum, notes: tradeForm.notes, date: tradeForm.date, session: tradeForm.session };
    setState(s => {
      const next = { ...s };
      if (s.phase === "funded") next.fundedTrades = [...s.fundedTrades, trade];
      else next.evalTrades = [...s.evalTrades, trade];
      return next;
    });
    setTradeForm({ pair: "", pnl: "", notes: "", date: today(), session: "New York" });
    setView("dashboard");
  };

  const passFunded = () => {
    setState(s => ({ ...s, phase: "funded", evalPassed: true, fundedStartBalance: balance, fundedTrades: [] }));
    setShowPassModal(false);
  };

  const reset = () => {
    setState(initialState);
    setShowResetConfirm(false);
  };

  if (state.phase === "setup") {
    return <Setup state={state} setState={setState} step={setupStep} setStep={setSetupStep} />;
  }

  if (isBlown) {
    return (
      <div style={{ fontFamily: "'DM Mono', monospace", background: "#0a0c0f", minHeight: "100vh", color: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; } @keyframes flicker { 0%,100%{opacity:1} 50%{opacity:0.85} } @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }`}</style>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: 80, marginBottom: 8, animation: "shake 0.6s ease" }}>💥</div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 52, color: "#ef4444", letterSpacing: "-2px", lineHeight: 1, marginBottom: 12, animation: "flicker 1.5s infinite" }}>BLOWN</div>
          <div style={{ color: "#6b7280", fontSize: 14, marginBottom: 32 }}>{state.phase === "funded" ? "Funded Account" : "Evaluation"} — Account Terminated</div>
          <div style={{ background: "#0f1419", border: "1px solid #3f1515", borderRadius: 16, padding: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #1a0a0a" }}>
              <span style={{ color: "#6b7280" }}>Reason</span>
              <span style={{ color: "#ef4444", fontSize: 13 }}>{blownReason}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #1a0a0a" }}>
              <span style={{ color: "#6b7280" }}>Total Drawdown</span>
              <span style={{ color: "#ef4444" }}>-${drawdownDollar.toFixed(2)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #1a0a0a" }}>
              <span style={{ color: "#6b7280" }}>Final Balance</span>
              <span style={{ color: "#ef4444" }}>${balance.toFixed(2)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #1a0a0a" }}>
              <span style={{ color: "#6b7280" }}>Total P&L</span>
              <span style={{ color: "#ef4444" }}>-${Math.abs(pnl).toFixed(2)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
              <span style={{ color: "#6b7280" }}>Days Traded</span>
              <span style={{ color: "#9ca3af" }}>{tradingDays}</span>
            </div>
          </div>
          <div style={{ color: "#4a5568", fontSize: 13, marginBottom: 28, fontStyle: "italic" }}>Review your trades, learn from the losses, and come back stronger.</div>
          <button onClick={() => setShowResetConfirm(true)} style={{ padding: "14px 40px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, cursor: "pointer", fontFamily: "'Syne', sans-serif", fontWeight: 700, letterSpacing: "0.5px" }}>Start Over</button>
        </div>
        {showResetConfirm && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 }}>
            <div style={{ background: "#0f1419", border: "1px solid #1a2332", borderRadius: 16, padding: 28, maxWidth: 360, width: "100%" }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Reset Everything?</div>
              <div style={{ color: "#9ca3af", fontSize: 14, marginBottom: 20 }}>This will clear all trades and restart setup.</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setShowResetConfirm(false)} style={{ flex: 1, padding: "10px", background: "transparent", border: "1px solid #1a2332", borderRadius: 8, color: "#9ca3af", cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>Cancel</button>
                <button onClick={reset} style={{ flex: 1, padding: "10px", background: "#7f1d1d", color: "#fca5a5", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>Reset All</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'DM Mono', monospace", background: "#0a0c0f", minHeight: "100vh", color: "#e2e8f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0a0c0f; } ::-webkit-scrollbar-thumb { background: #1e3a2f; border-radius: 2px; }
        input, select, textarea { outline: none; }
        .glow { box-shadow: 0 0 20px rgba(52,211,153,0.15); }
        .tab-active { background: #0f2018; color: #34d399; border-bottom: 2px solid #34d399; }
        .tab { color: #4a5568; border-bottom: 2px solid transparent; transition: all 0.2s; cursor: pointer; }
        .tab:hover { color: #9ca3af; }
        .card { background: #0f1419; border: 1px solid #1a2332; border-radius: 12px; }
        .btn-green { background: #34d399; color: #0a0c0f; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s; font-family: 'Syne', sans-serif; }
        .btn-green:hover { background: #6ee7b7; transform: translateY(-1px); }
        .btn-outline { background: transparent; color: #34d399; border: 1px solid #34d399; border-radius: 8px; cursor: pointer; transition: all 0.2s; font-family: 'DM Mono', monospace; }
        .btn-outline:hover { background: rgba(52,211,153,0.1); }
        .input-field { background: #0a0c0f; border: 1px solid #1a2332; border-radius: 8px; color: #e2e8f0; padding: 10px 14px; font-family: 'DM Mono', monospace; font-size: 14px; width: 100%; }
        .input-field:focus { border-color: #34d399; }
        .pos { color: #34d399; } .neg { color: #f87171; }
        .phase-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: 1px; font-family: 'Syne', sans-serif; }
        .eval-badge { background: rgba(251,191,36,0.15); color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); }
        .funded-badge { background: rgba(52,211,153,0.15); color: #34d399; border: 1px solid rgba(52,211,153,0.3); }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .fade-in { animation: fadeIn 0.4s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .progress-bar { height: 6px; border-radius: 3px; background: #1a2332; overflow: hidden; }
        .progress-fill { height: 100%; border-radius: 3px; transition: width 0.8s cubic-bezier(0.34,1.56,0.64,1); }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1a2332", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399" }} className="pulse" />
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: "-0.5px" }}>TRADELOG</span>
          <span style={{ color: "#4a5568", fontSize: 12 }}>PRO+</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className={`phase-badge ${state.phase === "funded" ? "funded-badge" : "eval-badge"}`}>
            {state.phase === "funded" ? "⚡ FUNDED" : "🎯 EVALUATION"}
          </span>
          {evalPassed && state.phase === "eval" && (
            <button className="btn-green" style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => setShowPassModal(true)}>
              🏆 PASS EVAL
            </button>
          )}
        </div>
      </div>

      {/* Nav */}
      <div style={{ borderBottom: "1px solid #1a2332", display: "flex", padding: "0 20px" }}>
        {[["dashboard", "Dashboard"], ["log", "Log Trade"], ["history", "History"], ["rules", "Rules"]].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{ padding: "14px 18px", fontSize: 13, background: "none", border: "none", fontFamily: "'DM Mono', monospace", letterSpacing: "0.5px" }} className={`tab ${view === id ? "tab-active" : ""}`}>{label}</button>
        ))}
        <button onClick={() => setShowResetConfirm(true)} style={{ marginLeft: "auto", padding: "14px 0", fontSize: 12, background: "none", border: "none", color: "#4a5568", cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>Reset</button>
      </div>

      <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }} className="fade-in">

        {/* DASHBOARD */}
        {view === "dashboard" && (
          <div>
            {/* Top stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Balance", value: `$${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, sub: `Started: $${startBalance.toLocaleString()}` },
                { label: "Total P&L", value: fmt(pnl), pct: fmtPct(pnlPct), pos: pnl >= 0 },
                { label: "Drawdown", value: `-$${drawdownDollar.toFixed(2)}`, sub: `Max: $${maxDrawdownAmt.toLocaleString()}`, warn: drawdownDollar > maxDrawdownAmt * 0.7 },
                { label: "Trading Days", value: tradingDays, sub: `Min required: ${state.minTradingDays}` },
              ].map((s, i) => (
                <div key={i} className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 11, color: "#4a5568", letterSpacing: "1px", marginBottom: 6, fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>{s.label.toUpperCase()}</div>
                  <div style={{ fontSize: 22, fontWeight: 500, color: s.warn ? "#fbbf24" : s.pos !== undefined ? (s.pos ? "#34d399" : "#f87171") : "#e2e8f0", lineHeight: 1.2 }}>{s.value}</div>
                  {s.pct && <div style={{ fontSize: 12, color: s.pos ? "#34d399" : "#f87171", marginTop: 2 }}>{s.pct}</div>}
                  {s.sub && <div style={{ fontSize: 11, color: "#4a5568", marginTop: 4 }}>{s.sub}</div>}
                </div>
              ))}
            </div>

            {/* Progress section - only for eval */}
            {state.phase === "eval" && (
              <div className="card" style={{ padding: 20, marginBottom: 20 }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "1px", color: "#9ca3af", marginBottom: 16 }}>EVALUATION PROGRESS</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: "#9ca3af" }}>Profit Target</span>
                      <span style={{ fontSize: 13, color: profitProgress >= 100 ? "#34d399" : "#e2e8f0" }}>{fmt(pnl)} / {fmt(profitTargetAmt)} {profitProgress >= 100 ? "✓" : ""}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${profitProgress}%`, background: profitProgress >= 100 ? "#34d399" : "linear-gradient(90deg, #1e5c40, #34d399)" }} />
                    </div>
                    <div style={{ fontSize: 11, color: "#4a5568", marginTop: 4 }}>{profitProgress.toFixed(1)}% of {state.profitTarget}% target</div>
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: "#9ca3af" }}>Min Trading Days</span>
                      <span style={{ fontSize: 13, color: daysProgress >= 100 ? "#34d399" : "#e2e8f0" }}>{tradingDays} / {state.minTradingDays} days {daysProgress >= 100 ? "✓" : ""}</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${daysProgress}%`, background: daysProgress >= 100 ? "#34d399" : "linear-gradient(90deg, #1e3c5c, #60a5fa)" }} />
                    </div>
                    <div style={{ fontSize: 11, color: "#4a5568", marginTop: 4 }}>{daysProgress.toFixed(1)}% complete</div>
                  </div>
                </div>
                {evalPassed && (
                  <div style={{ marginTop: 16, padding: "12px 16px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ color: "#34d399", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>🏆 ALL CONDITIONS MET — YOU PASSED!</span>
                    <button className="btn-green" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => setShowPassModal(true)}>Move to Funded →</button>
                  </div>
                )}
              </div>
            )}

            {/* Funded info */}
            {state.phase === "funded" && (
              <div className="card" style={{ padding: 20, marginBottom: 20, border: "1px solid rgba(52,211,153,0.2)" }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "1px", color: "#34d399", marginBottom: 16 }}>⚡ FUNDED ACCOUNT STATUS</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                  {[
                    { label: "PROFIT SPLIT", value: "90/10", highlight: true },
                    { label: "WITHDRAWALS", value: state.rules.withdrawals },
                    { label: "YOUR PROFIT", value: fmt(pnl * 0.9), highlight: true, pos: pnl >= 0 },
                    { label: "BUFFER REQ.", value: state.bufferRequirement ? `$${Number(state.bufferRequirement).toLocaleString()}` : "None" },
                    { label: "DRAWDOWN TYPE", value: state.drawdownType },
                    { label: "MAX DRAWDOWN", value: `$${(state.maxDrawdownAmt || 2000).toLocaleString()}` },
                    { label: "DAILY LOSS", value: state.maxDailyLossPct === 0 ? "OFF" : `${state.maxDailyLossPct}%` },
                    { label: "CONSISTENCY", value: state.rules.consistencyRule || "None" },
                    { label: "NEWS RULE", value: state.rules.newsRule },
                    { label: "ENVIRONMENT", value: state.rules.environment },
                    { label: "SCALING PLAN", value: state.rules.scalingPlan },
                    { label: "ACCOUNT SIZE", value: `$${state.accountSize.toLocaleString()}` },
                  ].map(({ label, value, highlight, pos }) => (
                    <div key={label} style={{ background: "#0a0c0f", borderRadius: 8, padding: "12px 14px", border: "1px solid #1a2332" }}>
                      <div style={{ fontSize: 10, color: "#4a5568", letterSpacing: "1px", marginBottom: 5, fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>{label}</div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: highlight ? (pos !== undefined ? (pos ? "#34d399" : "#f87171") : "#34d399") : "#e2e8f0" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent trades */}
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "1px", color: "#9ca3af" }}>RECENT TRADES</div>
                <button className="btn-outline" style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => setView("log")}>+ Log Trade</button>
              </div>
              {currentTrades.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#4a5568" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
                  <div>No trades yet. Start logging!</div>
                </div>
              ) : (
                [...currentTrades].reverse().slice(0, 5).map(t => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #0f1419" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <div style={{ background: t.pnl >= 0 ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)", border: `1px solid ${t.pnl >= 0 ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`, borderRadius: 6, padding: "2px 8px", fontSize: 12, color: t.pnl >= 0 ? "#34d399" : "#f87171", fontWeight: 600 }}>{t.pair}</div>
                      <div style={{ fontSize: 12, color: "#4a5568" }}>{t.date} · {t.session}</div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: t.pnl >= 0 ? "#34d399" : "#f87171" }}>{fmt(t.pnl)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* LOG TRADE */}
        {view === "log" && (
          <div style={{ maxWidth: 500, margin: "0 auto" }}>
            <div className="card" style={{ padding: 28 }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, marginBottom: 24 }}>Log a Trade</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#9ca3af", display: "block", marginBottom: 6, fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>DATE</label>
                  <input type="date" className="input-field" value={tradeForm.date} onChange={e => setTradeForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#9ca3af", display: "block", marginBottom: 6, fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>TRADING PAIR / INSTRUMENT</label>
                  <input className="input-field" placeholder="e.g. EUR/USD, NQ, BTC" value={tradeForm.pair} onChange={e => setTradeForm(f => ({ ...f, pair: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#9ca3af", display: "block", marginBottom: 6, fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>P&L ($)</label>
                  <input type="number" className="input-field" placeholder="e.g. 250.00 or -120.00" value={tradeForm.pnl} onChange={e => setTradeForm(f => ({ ...f, pnl: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#9ca3af", display: "block", marginBottom: 6, fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>SESSION</label>
                  <select className="input-field" value={tradeForm.session} onChange={e => setTradeForm(f => ({ ...f, session: e.target.value }))}>
                    {["London", "New York", "Asian", "London/NY Overlap"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#9ca3af", display: "block", marginBottom: 6, fontFamily: "'Syne', sans-serif", fontWeight: 600 }}>NOTES (optional)</label>
                  <textarea className="input-field" placeholder="Setup, emotions, lesson learned..." rows={3} style={{ resize: "vertical" }} value={tradeForm.notes} onChange={e => setTradeForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                {formError && <div style={{ color: "#f87171", fontSize: 13 }}>⚠ {formError}</div>}
                <button className="btn-green" style={{ padding: "14px", fontSize: 15, fontFamily: "'Syne', sans-serif", fontWeight: 700 }} onClick={logTrade}>LOG TRADE</button>
              </div>
            </div>
          </div>
        )}

        {/* HISTORY */}
        {view === "history" && (
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, marginBottom: 20 }}>
              Trade History — <span style={{ color: "#4a5568", fontWeight: 400 }}>{currentTrades.length} trades</span>
            </div>
            {Object.entries(getDailyPnl(currentTrades)).sort((a, b) => b[0].localeCompare(a[0])).map(([date, dayPnl]) => (
              <div key={date} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1a2332", marginBottom: 8 }}>
                  <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 13, color: "#9ca3af" }}>{date}</span>
                  <span style={{ fontSize: 13, color: dayPnl >= 0 ? "#34d399" : "#f87171", fontWeight: 600 }}>Day: {fmt(dayPnl)}</span>
                </div>
                {currentTrades.filter(t => t.date === date).map(t => (
                  <div key={t.id} className="card" style={{ padding: "12px 16px", marginBottom: 6, display: "flex", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: t.notes ? 6 : 0 }}>
                        <span style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 14 }}>{t.pair}</span>
                        <span style={{ fontSize: 11, color: "#4a5568" }}>{t.session}</span>
                      </div>
                      {t.notes && <div style={{ fontSize: 12, color: "#6b7280" }}>{t.notes}</div>}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 500, color: t.pnl >= 0 ? "#34d399" : "#f87171", whiteSpace: "nowrap" }}>{fmt(t.pnl)}</div>
                  </div>
                ))}
              </div>
            ))}
            {currentTrades.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#4a5568" }}>No trades logged yet.</div>
            )}
          </div>
        )}

        {/* RULES */}
        {view === "rules" && (
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, marginBottom: 20 }}>Account Rules — PRO+</div>
            <div className="card" style={{ overflow: "hidden" }}>
              {[
                ["Environment", state.rules.environment],
                ["Withdrawals", state.rules.withdrawals],
                ["Profit Split", state.rules.profitSplit],
                ["Maximum # of Accounts", state.rules.maxAccounts],
                ["Maximum Withdrawal Amount", state.rules.maxWithdrawalAmount],
                ["Buffer Requirement", state.bufferRequirement ? `$${state.bufferRequirement.toLocaleString()}` : state.rules.bufferRequirement || "None"],
                ["Daily Loss Rule", `${state.maxDailyLossPct}% Max Daily Loss`],
                ["Drawdown", `${state.drawdownType} — $${(state.maxDrawdownAmt || 2000).toLocaleString()}`],
                ["Consistency Rule", state.rules.consistencyRule || "None"],
                ["News Rule", state.rules.newsRule],
                ["Scaling Plan", state.rules.scalingPlan],
                ["Min Trading Days", `${state.minTradingDays} days`],
                ["Profit Target", `${state.profitTarget}%`],
                ["Account Size", `$${state.accountSize.toLocaleString()}`],
              ].map(([key, val], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: i < 13 ? "1px solid #0f1419" : "none" }}>
                  <span style={{ fontSize: 13, color: "#9ca3af" }}>{key}</span>
                  <span style={{ fontSize: 13, color: "#34d399", fontWeight: 500 }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pass Eval Modal */}
      {showPassModal && (
        <div className="modal-overlay">
          <div className="card" style={{ padding: 32, maxWidth: 400, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏆</div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, marginBottom: 8 }}>EVALUATION PASSED!</div>
            <div style={{ color: "#9ca3af", marginBottom: 24, fontSize: 14 }}>Congratulations! You've met all requirements. Move to your funded account and continue trading.</div>
            <div style={{ background: "#0a0c0f", borderRadius: 8, padding: 16, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={{ color: "#4a5568" }}>Eval P&L</span><span className="pos">{fmt(pnl)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={{ color: "#4a5568" }}>Trading Days</span><span style={{ color: "#e2e8f0" }}>{tradingDays}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#4a5568" }}>Funded Balance</span><span style={{ color: "#34d399" }}>${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button className="btn-outline" style={{ flex: 1, padding: "12px" }} onClick={() => setShowPassModal(false)}>Cancel</button>
              <button className="btn-green" style={{ flex: 1, padding: "12px", fontSize: 14 }} onClick={passFunded}>Move to Funded →</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirm */}
      {showResetConfirm && (
        <div className="modal-overlay">
          <div className="card" style={{ padding: 28, maxWidth: 360, width: "100%" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Reset Everything?</div>
            <div style={{ color: "#9ca3af", fontSize: 14, marginBottom: 20 }}>This will delete all trades and account data. This cannot be undone.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-outline" style={{ flex: 1, padding: "10px" }} onClick={() => setShowResetConfirm(false)}>Cancel</button>
              <button style={{ flex: 1, padding: "10px", background: "#7f1d1d", color: "#fca5a5", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "'DM Mono', monospace" }} onClick={reset}>Reset All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Setup({ state, setState, step, setStep }) {
  const [form, setForm] = useState({
    accountSize: 10000,
    profitTarget: 10,
    minTradingDays: 5,
    drawdownType: "End Of Day",
    maxDrawdownPct: 5,
    maxDrawdownAmt: 2000,
    maxDailyLossPct: 2,
    consistencyRule: "None",
  });

  const finish = () => {
    const bufferMap = { 25000: 1000, 50000: 2000, 100000: 4000, 150000: 6000 };
    const bufferAmt = bufferMap[form.accountSize] || form.accountSize * 0.04;
    setState(s => ({
      ...s,
      ...form,
      phase: "eval",
      evalStartBalance: form.accountSize,
      fundedStartBalance: form.accountSize,
      bufferRequirement: bufferAmt,
      rules: { ...s.rules, consistencyRule: form.consistencyRule, bufferRequirement: `$${bufferAmt.toLocaleString()}` },
      evalTrades: [],
      fundedTrades: [],
    }));
  };

  const steps = [
    {
      title: "Account Size",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[25000, 50000, 100000, 150000].map(v => {
            const bufferMap = { 25000: 1000, 50000: 2000, 100000: 4000, 150000: 6000 };
            return (
            <button key={v} onClick={() => setForm(f => ({ ...f, accountSize: v }))} style={{ padding: "14px 20px", background: form.accountSize === v ? "rgba(52,211,153,0.15)" : "#0a0c0f", border: `1px solid ${form.accountSize === v ? "#34d399" : "#1a2332"}`, borderRadius: 10, color: form.accountSize === v ? "#34d399" : "#9ca3af", fontSize: 16, cursor: "pointer", fontFamily: "'Syne', sans-serif", fontWeight: 600, transition: "all 0.15s", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>${v.toLocaleString()}</span>
              <span style={{ fontSize: 12, opacity: 0.6, fontFamily: "'DM Mono', monospace", fontWeight: 400 }}>Buffer: ${bufferMap[v].toLocaleString()} <span style={{ color: "#34d399", opacity: 1 }}>(Funded)</span></span>
            </button>
            );
          })}
        </div>
      )
    },
    {
      title: "Profit Target",
      content: (
        <div>
          <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 16 }}>What % profit to pass the evaluation?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[6, 8, 10, 12, 15].map(v => (
              <button key={v} onClick={() => setForm(f => ({ ...f, profitTarget: v }))} style={{ padding: "14px 20px", background: form.profitTarget === v ? "rgba(52,211,153,0.15)" : "#0a0c0f", border: `1px solid ${form.profitTarget === v ? "#34d399" : "#1a2332"}`, borderRadius: 10, color: form.profitTarget === v ? "#34d399" : "#9ca3af", fontSize: 15, cursor: "pointer", fontFamily: "'Syne', sans-serif", fontWeight: 600, transition: "all 0.15s", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{v}%</span><span style={{ fontSize: 13, opacity: 0.6 }}>${((form.accountSize * v) / 100).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      )
    },
    {
      title: "Minimum Trading Days",
      content: (
        <div>
          <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 16 }}>How many days must you trade before passing?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3, 5].map(v => (
              <button key={v} onClick={() => setForm(f => ({ ...f, minTradingDays: v }))} style={{ padding: "14px 20px", background: form.minTradingDays === v ? "rgba(52,211,153,0.15)" : "#0a0c0f", border: `1px solid ${form.minTradingDays === v ? "#34d399" : "#1a2332"}`, borderRadius: 10, color: form.minTradingDays === v ? "#34d399" : "#9ca3af", fontSize: 15, cursor: "pointer", fontFamily: "'Syne', sans-serif", fontWeight: 600, transition: "all 0.15s" }}>
                {v} days
              </button>
            ))}
          </div>
        </div>
      )
    },
    {
      title: "Consistency Rule",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>Should your biggest trading day be limited to 50% of total profit?</div>
          {[
            { val: "50% Consistency", label: "50% Consistency", desc: "No single day can account for more than 50% of your total profit" },
            { val: "None", label: "No Consistency Rule", desc: "Trade freely with no restrictions on daily profit distribution" },
          ].map(({ val, label, desc }) => (
            <button key={val} onClick={() => setForm(f => ({ ...f, consistencyRule: val }))} style={{ padding: "18px 20px", background: form.consistencyRule === val ? "rgba(52,211,153,0.15)" : "#0a0c0f", border: `1px solid ${form.consistencyRule === val ? "#34d399" : "#1a2332"}`, borderRadius: 10, color: "#e2e8f0", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: form.consistencyRule === val ? "#34d399" : "#e2e8f0", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>{desc}</div>
            </button>
          ))}
        </div>
      )
    },
    {
      title: "Drawdown Rules",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10, fontFamily: "'Syne', sans-serif", fontWeight: 600, letterSpacing: "1px" }}>DRAWDOWN TYPE</div>
            <div style={{ display: "flex", gap: 10 }}>
              {["End Of Day", "Trailing", "Static"].map(v => (
                <button key={v} onClick={() => setForm(f => ({ ...f, drawdownType: v }))} style={{ flex: 1, padding: "12px", background: form.drawdownType === v ? "rgba(52,211,153,0.15)" : "#0a0c0f", border: `1px solid ${form.drawdownType === v ? "#34d399" : "#1a2332"}`, borderRadius: 8, color: form.drawdownType === v ? "#34d399" : "#6b7280", fontSize: 12, cursor: "pointer", fontFamily: "'DM Mono', monospace", transition: "all 0.15s" }}>{v}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10, fontFamily: "'Syne', sans-serif", fontWeight: 600, letterSpacing: "1px" }}>MAX TOTAL DRAWDOWN</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[1500, 2000, 3000, 5000].map(v => (
                <button key={v} onClick={() => setForm(f => ({ ...f, maxDrawdownAmt: v }))} style={{ flex: 1, padding: "10px 0", background: form.maxDrawdownAmt === v ? "rgba(52,211,153,0.15)" : "#0a0c0f", border: `1px solid ${form.maxDrawdownAmt === v ? "#34d399" : "#1a2332"}`, borderRadius: 8, color: form.maxDrawdownAmt === v ? "#34d399" : "#6b7280", fontSize: 13, cursor: "pointer", fontFamily: "'DM Mono', monospace", transition: "all 0.15s" }}>${v.toLocaleString()}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10, fontFamily: "'Syne', sans-serif", fontWeight: 600, letterSpacing: "1px" }}>MAX DAILY LOSS</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[1, 2, 3, 0].map(v => (
                <button key={v} onClick={() => setForm(f => ({ ...f, maxDailyLossPct: v }))} style={{ flex: 1, padding: "10px 0", background: form.maxDailyLossPct === v ? "rgba(52,211,153,0.15)" : "#0a0c0f", border: `1px solid ${form.maxDailyLossPct === v ? "#34d399" : "#1a2332"}`, borderRadius: 8, color: form.maxDailyLossPct === v ? "#34d399" : "#6b7280", fontSize: 13, cursor: "pointer", fontFamily: "'DM Mono', monospace", transition: "all 0.15s" }}>{v === 0 ? "OFF" : `${v}%`}</button>
              ))}
            </div>
          </div>
        </div>
      )
    }
  ];

  return (
    <div style={{ fontFamily: "'DM Mono', monospace", background: "#0a0c0f", minHeight: "100vh", color: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; } .btn-green { background: #34d399; color: #0a0c0f; font-weight: 700; border: none; border-radius: 10px; cursor: pointer; transition: all 0.2s; font-family: 'Syne', sans-serif; } .btn-green:hover { background: #6ee7b7; }`}</style>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 28, letterSpacing: "-1px", marginBottom: 8 }}>TRADELOG <span style={{ color: "#34d399" }}>PRO+</span></div>
          <div style={{ color: "#4a5568", fontSize: 14 }}>Set up your evaluation account</div>
        </div>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: 6, marginBottom: 32, justifyContent: "center" }}>
          {steps.map((_, i) => (
            <div key={i} style={{ height: 4, flex: 1, maxWidth: 60, borderRadius: 2, background: i <= step ? "#34d399" : "#1a2332", transition: "background 0.3s" }} />
          ))}
        </div>

        <div style={{ background: "#0f1419", border: "1px solid #1a2332", borderRadius: 16, padding: 28, marginBottom: 20 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, marginBottom: 24 }}>{steps[step].title}</div>
          {steps[step].content}
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {step > 0 && <button onClick={() => setStep(s => s - 1)} style={{ flex: 1, padding: "14px", background: "transparent", border: "1px solid #1a2332", borderRadius: 10, color: "#9ca3af", cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>← Back</button>}
          {step < steps.length - 1
            ? <button className="btn-green" style={{ flex: 1, padding: "14px", fontSize: 15 }} onClick={() => setStep(s => s + 1)}>Next →</button>
            : <button className="btn-green" style={{ flex: 1, padding: "14px", fontSize: 15 }} onClick={finish}>Start Evaluation 🚀</button>
          }
        </div>
      </div>
    </div>
  );
}
