import React, { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, BrainCircuit, CheckCircle2, CircleDollarSign, Clock3, LoaderCircle, Plus, ReceiptText, RefreshCw, Sparkles, Wallet } from "lucide-react";

const API = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");
const example = "I spent 450 rupees on lunch at Green Bowl today using UPI.";
const money = n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);
const localMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };

export default function App() {
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState({ income: 0, expenses: 0, balance: 0, categories: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [goalDraft, setGoalDraft] = useState(null);
  const [goals, setGoals] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [insights, setInsights] = useState(null);
  const [insightMonth, setInsightMonth] = useState(localMonth());
  const [service, setService] = useState({ checked: false, ok: false, ai: "unknown", loginConfigured: false });
  const [goalLoading, setGoalLoading] = useState(false);
  const [goalSaving, setGoalSaving] = useState(false);
  const [budgetSaving, setBudgetSaving] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [budgetValues, setBudgetValues] = useState({});
  const [token, setToken] = useState(() => localStorage.getItem("finpilot-session") || "");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authMode, setAuthMode] = useState("login");

  async function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const response = await fetch(`${API}${path}`, { ...options, headers });
    if (response.status === 401 && token) { localStorage.removeItem("finpilot-session"); setToken(""); }
    return response;
  }

  async function authenticate(e) {
    e.preventDefault(); setLoginError(""); setLoginBusy(true);
    try {
      if (authMode === "signup" && password !== confirmPassword) throw new Error("Passwords do not match.");
      const endpoint = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const r = await fetch(`${API}${endpoint}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username,password}) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || (authMode === "signup" ? "Could not create account." : "Sign in failed."));
      localStorage.setItem("finpilot-session", d.token); setToken(d.token); setPassword("");
    } catch (err) { setLoginError(err.message || "Could not reach the sign-in service."); }
    finally { setLoginBusy(false); }
  }

  async function refresh() {
    try {
      const [txRes, sumRes] = await Promise.all([apiFetch('/api/transactions'), apiFetch('/api/summary')]);
      const txData = await txRes.json();
      const sumData = await sumRes.json();
      if (!txRes.ok) throw new Error(txData.error || "Could not load transactions.");
      if (!sumRes.ok) throw new Error(sumData.error || "Could not load summary.");
      setTransactions(txData.transactions || []);
      setSummary(sumData.summary || { income: 0, expenses: 0, balance: 0, categories: [] });
    } catch (e) { setError(e.message || "Could not connect to backend."); }
  }

  useEffect(() => { checkHealth(); }, []);
  useEffect(() => { if (token) { refresh(); loadExtra(); } else { setTransactions([]); setGoals([]); setBudgets([]); setSummary({income:0,expenses:0,balance:0,categories:[]}); } }, [token]);

  async function checkHealth() {
    try {
      const r = await fetch(`${API}/api/health`); const d = await r.json();
      setService({ checked: true, ok: r.ok && d.ok, ai: d.ai || "unknown", loginConfigured: !!d.loginConfigured });
    } catch { setService({ checked: true, ok: false, ai: "unavailable", loginConfigured: false }); }
  }

  async function loadExtra() {
    try {
      const [g,b] = await Promise.all([apiFetch('/api/goals'),apiFetch('/api/budgets')]);
      if (g.ok) setGoals((await g.json()).goals || []);
      if (b.ok) { const rows=(await b.json()).budgets || []; setBudgets(rows); setBudgetValues(Object.fromEntries(rows.map(x=>[x.category,String(x.monthlyLimit||"")]))); }
    } catch { /* backend errors are shown by the main refresh */ }
  }

  function startVoice() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { setError("Voice input is not supported in this browser. Use Chrome or type the expense."); return; }
    const recognition = new Speech(); recognition.lang = "en-IN"; recognition.interimResults = false;
    recognition.onresult = e => setInput(prev => `${prev}${prev ? " " : ""}${e.results[0][0].transcript}`);
    recognition.onerror = () => setError("Voice capture failed. Check microphone permission or type the expense.");
    recognition.start();
  }

  async function extractReceipt(file) {
    if (!file) return;
    setError(""); setMessage(""); setReceiptLoading(true);
    try {
      const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      const response = await apiFetch('/api/receipts/extract', { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({data,mimeType:file.type}) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Receipt extraction failed.");
      setDraft({...result.transaction}); setInput(`Receipt upload: ${file.name}`); setMessage("Receipt extracted into a draft. Review the fields before saving.");
    } catch(e) {
      const reason = e.message || "Could not read receipt.";
      if (/gemini.*(503|overload|unavailable|high demand)|503 unavailable|temporarily busy/i.test(reason)) {
        const today = new Date();
        const todayText = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
        setInput(`Receipt: ${file.name}`);
        setDraft({amount:0,currency:"INR",merchant:null,category:"Other",transactionDate:todayText,paymentMethod:null,note:`Receipt: ${file.name}`,transactionType:"expense"});
        setMessage("Gemini is temporarily busy, so the receipt could not be read automatically. A manual draft is ready—enter the receipt details and review them before saving.");
      } else setError(reason);
    } finally { setReceiptLoading(false); }
  }

  async function planGoal() {
    setError(""); setMessage(""); setGoalDraft(null); setGoalLoading(true);
    try { const r=await apiFetch('/api/goals/plan',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({input:goalInput})}); const d=await r.json(); if(!r.ok) throw new Error(d.error||"Could not create plan"); setGoalDraft(d.goal); setMessage("Goal plan is ready. Review the target and milestones before saving."); }
    catch(e){setError(e.message || "Could not create goal plan.");} finally { setGoalLoading(false); }
  }
  async function saveGoal() {
    setGoalSaving(true);
    try { const r=await apiFetch('/api/goals',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goal:goalDraft})}); const d=await r.json(); if(!r.ok) throw new Error(d.error||"Could not save goal"); setGoalDraft(null);setGoalInput("");await loadExtra();setMessage("Savings goal saved to your workspace."); }
    catch(e){setError(e.message || "Could not save goal.");} finally {setGoalSaving(false);}
  }
  async function saveBudget(category, monthlyLimit) {
    setError(""); setMessage(""); setBudgetSaving(category);
    try { if(monthlyLimit==="" || !Number.isFinite(Number(monthlyLimit)) || Number(monthlyLimit)<0) throw new Error("Enter a valid non-negative monthly limit."); const r=await apiFetch('/api/budgets',{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({category,monthlyLimit:Number(monthlyLimit)})}); const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not save budget");await loadExtra();setMessage(`${category} budget updated.`); }
    catch(e){setError(e.message || "Could not save budget.");} finally {setBudgetSaving("");}
  }
  async function generateInsights() {
    setError("");setInsights(null);setInsightLoading(true);
    try { const r=await apiFetch('/api/insights/monthly',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({month:insightMonth})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not generate insights");setInsights(d.insights); }
    catch(e){setError(e.message || "Could not generate insights.");} finally {setInsightLoading(false);}
  }

  async function extract() {
    setError(""); setMessage(""); setDraft(null);
    if (input.trim().length < 8) { setError("Describe an expense or income in at least 8 characters."); return; }
    setLoading(true);
    try {
      const response = await apiFetch('/api/transactions/extract', {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not extract transaction.");
      setDraft({ ...data.transaction });
      setMessage("Transaction draft is ready. Review the fields before saving.");
    } catch (e) { setError(e.message || "Request failed."); }
    finally { setLoading(false); }
  }

  async function saveDraft() {
    setError(""); setMessage(""); setSaving(true);
    try {
      const response = await apiFetch('/api/transactions', {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: draft, originalInput: input.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save transaction.");
      setDraft(null); setInput(""); setMessage(data.message || "Transaction saved.");
      await refresh();
    } catch (e) { setError(e.message || "Save failed."); }
    finally { setSaving(false); }
  }

  const expensesByCategory = summary.categories.filter(c => c.type === "expense").sort((a,b) => b.total - a.total);
  const monthlySpend = transactions.filter(t => t.transactionType === "expense" && (t.transactionDate || "").startsWith(localMonth())).reduce((sum,t)=>sum+Number(t.amount||0),0);
  const signOut = () => { localStorage.removeItem("finpilot-session"); setToken(""); setDraft(null); setGoalDraft(null); setMessage(""); setError(""); };

  if (!token) return <LoginPage username={username} setUsername={setUsername} password={password} setPassword={setPassword} confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword} mode={authMode} setMode={mode=>{setAuthMode(mode);setLoginError("");setConfirmPassword("");setUsername("");}} onSubmit={authenticate} busy={loginBusy} error={loginError} service={service}/>;

  return <div className="shell">
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark"><BrainCircuit size={22}/></span><span>FinPilot<span className="brand-dot">.</span></span></a>
      <div className="top-right"><span className={`status-dot ${service.checked && !service.ok ? "offline" : ""}`}/><span>{service.checked ? service.ok ? "WORKSPACE CONNECTED" : "API UNAVAILABLE" : "CHECKING WORKSPACE"}</span>{service.ok && <span className="ai-mode">{service.ai === "configured" ? "GEMINI AI" : "LOCAL DEMO MODE"}</span>}<button className="sign-out" onClick={signOut}>Sign out</button><span className="avatar">FP</span></div>
    </header>
    <main>
      <section className="welcome">
        <div><div className="eyebrow"><Sparkles size={14}/> YOUR MONEY, MADE CLEARER</div><h1>Make every rupee<br/><span>make sense.</span></h1><p>Turn everyday money notes into organized transactions and clearer spending insights.</p></div>
        <div className="hero-graphic"><div className="graphic-ring ring-one"/><div className="graphic-ring ring-two"/><div className="graphic-center"><Wallet size={35}/></div><span className="float-chip chip-a">₹ <span>Track</span></span><span className="float-chip chip-b"><CheckCircle2 size={14}/> Organized</span></div>
      </section>

      {error && <div className="alert error"><strong>Something needs attention</strong><span>{error}</span></div>}
      {message && <div className="alert success"><CheckCircle2 size={17}/><span>{message}</span></div>}

      {service.checked && service.ok && service.ai !== "configured" && <div className="alert info"><BrainCircuit size={17}/><span>Local demo mode is active. Text extraction and goal planning use the built-in fallback; add a Gemini API key to enable generative extraction and receipt reading.</span></div>}
      <section className="stats">
        <Stat icon={<ArrowUpRight size={18}/>} label="TOTAL EXPENSES" value={money(summary.expenses)} note="All saved expense records"/>
        <Stat icon={<ReceiptText size={18}/>} label="TRANSACTIONS" value={transactions.length} note="Records in your ledger"/>
        <Stat icon={<CircleDollarSign size={18}/>} label="SPENT THIS MONTH" value={money(monthlySpend)} note={new Date().toLocaleDateString("en-IN",{month:"long",year:"numeric"})}/>
      </section>

      <section className="main-grid">
        <div className="panel input-panel">
          <div className="panel-head"><div><div className="overline">AI TRANSACTION ENTRY</div><h2>Capture a transaction</h2></div><span className="ai-tag"><Sparkles size={13}/> AI POWERED</span></div>
          <p className="subtext">Describe a purchase or income naturally. FinPilot will turn it into structured fields for you to review.</p>
          <label htmlFor="expense-note">Your money note</label>
          <textarea id="expense-note" value={input} onChange={e => setInput(e.target.value)} maxLength={1500} placeholder="e.g. I spent ₹250 on petrol yesterday using UPI..." />
          <div className="draft-actions"><button className="secondary" onClick={startVoice}>🎙 Speak expense</button><label className="secondary" style={{display:"inline-flex",alignItems:"center",cursor:"pointer"}}>🧾 Upload receipt<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden onChange={e=>{const f=e.target.files?.[0];if(f && f.size>6*1024*1024){setError("Receipt must be smaller than 6 MB.");e.target.value="";return;}extractReceipt(f);e.target.value=""}}/></label>{receiptLoading && <span>Reading receipt…</span>}</div>
          <div className="input-bottom"><button className="link-button" onClick={() => setInput(example)}>Try example</button><span>{input.length}/1500</span></div>
          <button className="primary" onClick={extract} disabled={loading}>{loading ? <><LoaderCircle className="spin" size={17}/> Extracting…</> : <><Sparkles size={17}/> Extract transaction <ArrowUpRight size={17}/></>}</button>
          <p className="fine-print">AI output is a draft. Check all fields before saving. No bank account is connected.</p>

          {draft && <div className="draft-box">
            <div className="draft-head"><div><div className="overline">REVIEW REQUIRED</div><h3>Confirm transaction</h3></div><span className="draft-status">UNSAVED DRAFT</span></div>
            <div className="form-grid">
              <Field label="Amount (₹)"><input type="number" min="0.01" step="0.01" value={draft.amount} onChange={e => setDraft({...draft, amount: Number(e.target.value)})}/></Field>
              <Field label="Type"><select value={draft.transactionType} onChange={e => setDraft({...draft, transactionType:e.target.value})}><option value="expense">Expense</option><option value="income">Income</option></select></Field>
              <Field label="Merchant (optional)"><input value={draft.merchant || ""} onChange={e => setDraft({...draft, merchant:e.target.value || null})} placeholder="Unknown"/></Field>
              <Field label="Category"><select value={draft.category} onChange={e => setDraft({...draft, category:e.target.value})}>{["Food","Transport","Shopping","Bills","Health","Education","Entertainment","Groceries","Travel","Income","Other"].map(v=><option key={v}>{v}</option>)}</select></Field>
              <Field label="Date (optional)"><input type="date" value={draft.transactionDate || ""} onChange={e => setDraft({...draft, transactionDate:e.target.value || null})}/></Field>
              <Field label="Payment method"><select value={draft.paymentMethod || ""} onChange={e => setDraft({...draft, paymentMethod:e.target.value || null})}><option value="">Not specified</option>{["Cash","UPI","Card","Bank Transfer","Other"].map(v=><option key={v}>{v}</option>)}</select></Field>
              <Field label="Note"><input value={draft.note} onChange={e => setDraft({...draft, note:e.target.value})} maxLength={300}/></Field>
            </div>
            <div className="draft-actions"><button className="secondary" onClick={() => setDraft(null)}>Discard</button><button className="primary save-button" disabled={saving || !(Number(draft.amount) > 0) || !draft.note.trim()} onClick={saveDraft}>{saving ? <LoaderCircle className="spin" size={16}/> : <CheckCircle2 size={16}/>} Confirm &amp; save</button></div>
          </div>}
        </div>

        <div className="panel category-panel">
          <div className="panel-head"><div><div className="overline">SPENDING BREAKDOWN</div><h2>Where it goes</h2></div><span className="round-icon"><CircleDollarSign size={19}/></span></div>
          {expensesByCategory.length === 0 ? <div className="chart-empty"><div className="chart-icon"><ReceiptText size={25}/></div><strong>Your spending story starts here</strong><p>Save your first expense to see category totals.</p></div> : <div className="category-list">{expensesByCategory.map((c,i)=>{const pct=summary.expenses ? Math.min(100,c.total/summary.expenses*100):0;return <div className="category-row" key={c.category}><div className="category-meta"><span>{c.category}</span><strong>{money(c.total)}</strong></div><div className="bar"><span style={{width:`${pct}%`}}/></div><div className="category-foot"><span>{c.count} transaction{c.count===1?"":"s"}</span><span>{pct.toFixed(0)}% of expenses</span></div></div>})}</div>}
          <button className="refresh" onClick={refresh}><RefreshCw size={14}/> Refresh data</button>
        </div>
      </section>

      <section className="main-grid" style={{marginTop:24}}>
        <div className="panel">
          <div className="overline">SAVINGS GOALS</div><h2>Plan a savings goal</h2><p className="subtext">Try: “Save ₹30,000 for a laptop in 6 months.”</p>
          <textarea value={goalInput} onChange={e=>setGoalInput(e.target.value)} placeholder="Describe your savings goal…" />
          <button className="primary" disabled={goalInput.trim().length<8 || goalLoading} onClick={planGoal}>{goalLoading ? <><LoaderCircle className="spin" size={16}/> Planning…</> : "Create goal plan"}</button>
          {goalDraft && <div className="draft-box"><h3>{goalDraft.title}</h3><p>Target: {money(goalDraft.targetAmount)} · Deadline: {goalDraft.deadline}</p><p>Suggested monthly saving: {money(goalDraft.monthlySaving)}</p><ul>{goalDraft.milestones?.map((m,i)=><li key={i}>{m.title}: {money(m.targetAmount)} by {m.targetDate}</li>)}</ul><div className="draft-actions"><button className="secondary" onClick={()=>setGoalDraft(null)}>Discard</button><button className="primary" disabled={goalSaving} onClick={saveGoal}>{goalSaving ? "Saving…" : "Confirm and save goal"}</button></div></div>}
          {goals.map(g=><div className="category-row" key={g._id}><strong>{g.title}</strong><p>{money(g.targetAmount)} by {g.deadline} · {money(g.monthlySaving)}/month</p></div>)}
        </div>
        <div className="panel budget-panel">
          <div className="overline">MONTHLY BUDGETS</div><h2>Set category limits</h2><p className="subtext">Enter a monthly budget and save each category.</p>
          <div className="budget-list">{budgets.map(b=>{const value=budgetValues[b.category] ?? "";const valid=value!==""&&Number.isFinite(Number(value))&&Number(value)>=0;return <div className="budget-item" key={b.category}><div className="category-meta"><strong>{b.category}</strong><span>Spent {money(b.spent)}</span></div><div className="budget-controls"><input aria-label={`${b.category} monthly budget`} type="number" min="0" step="0.01" value={value} onChange={e=>setBudgetValues({...budgetValues,[b.category]:e.target.value})} placeholder="Monthly limit ₹"/><button className="secondary" disabled={budgetSaving===b.category||!valid} onClick={()=>saveBudget(b.category,value)}>{budgetSaving===b.category ? "Saving…" : "Save"}</button></div>{b.monthlyLimit>0 && <small>{b.spent>b.monthlyLimit?"Over budget":"Within budget"} · Limit {money(b.monthlyLimit)}</small>}</div>})}</div>
        </div>
      </section>
      <section className="panel" style={{marginTop:24}}>
        <div className="overline">AI MONTHLY REVIEW</div><h2>Spending patterns and action items</h2><p className="subtext">FinPilot analyzes dated saved transactions. Review its suggestions; it never changes budgets automatically.</p>
        <div className="draft-actions"><input aria-label="Insights month" type="month" value={insightMonth} onChange={e=>setInsightMonth(e.target.value)}/><button className="primary" disabled={insightLoading || !insightMonth} onClick={generateInsights}>{insightLoading ? <><LoaderCircle className="spin" size={16}/> Analyzing…</> : "Generate monthly insights"}</button></div>
        {insights && <div className="draft-box"><h3>Summary</h3><p>{insights.summary}</p><h3>Patterns</h3><ul>{(insights.patterns||[]).map((v,i)=><li key={i}>{v}</li>)}</ul><h3>Action items for your review</h3><ul>{(insights.actionItems||[]).map((v,i)=><li key={i}>{v}</li>)}</ul><small>Analyzed {insights.transactionsAnalyzed} dated transaction(s). Suggestions are not applied automatically.</small></div>}
      </section>

      <section className="ledger-section">
        <div className="ledger-title"><div><div className="overline">YOUR RECORDS</div><h2>Recent transactions <span>{transactions.length}</span></h2></div><button className="refresh" onClick={refresh}><RefreshCw size={14}/> Refresh</button></div>
        {transactions.length === 0 ? <div className="ledger-empty"><ReceiptText size={25}/><strong>No transactions yet</strong><p>Extract an expense above, review it, and save it to your ledger.</p></div> :
          <div className="table-wrap"><table><thead><tr><th>TRANSACTION</th><th>CATEGORY</th><th>DATE</th><th>PAYMENT</th><th>AMOUNT</th></tr></thead><tbody>{transactions.map(t=><tr key={t._id}><td><div className="tx-name"><span className={`tx-icon ${t.transactionType}`} >{t.transactionType==="income"?<ArrowDownLeft size={17}/>:<ArrowUpRight size={17}/>}</span><div><strong>{t.merchant || t.note}</strong><small>{t.note}</small></div></div></td><td><span className="category-pill">{t.category}</span></td><td>{t.transactionDate || "—"}</td><td>{t.paymentMethod || "—"}</td><td className={t.transactionType==="income"?"income-amount":"expense-amount"}>{t.transactionType==="income"?"+":"−"}{money(t.amount)}</td></tr>)}</tbody></table></div>}
      </section>
      <footer><span>FinPilot<span className="brand-dot">.</span></span><span>Educational expense tracker · Not financial advice · Review AI-generated data</span></footer>
    </main>
  </div>;
}

function Stat({icon,label,value,note}) { return <div className="stat-card"><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span></div><strong className="stat-value">{value}</strong><span className="stat-note">{note}</span></div>; }
function Field({label,children}) { return <label className="field"><span>{label}</span>{children}</label>; }
function LoginPage({username,setUsername,password,setPassword,confirmPassword,setConfirmPassword,mode,setMode,onSubmit,busy,error,service}) {
  const signingUp=mode==="signup";
  return <div className="login-screen"><header className="login-top"><a className="brand" href="#"><span className="brand-mark"><BrainCircuit size={22}/></span><span>FinPilot<span className="brand-dot">.</span></span></a><span className="login-secure"><span className={`status-dot ${service.checked&&!service.ok?"offline":""}`}/>{service.checked&&service.ok?"Secure workspace":"Connecting to workspace"}</span></header>
    <main className="login-layout"><section className="login-intro"><div className="eyebrow"><Sparkles size={14}/> YOUR MONEY, MADE CLEARER</div><h1>A clearer view<br/>of your <span>finances.</span></h1><p>One private workspace for your spending, savings goals, and monthly insights.</p><div className="login-features"><span><CheckCircle2 size={17}/> Review every transaction before saving</span><span><CheckCircle2 size={17}/> Keep goals and budgets together</span><span><CheckCircle2 size={17}/> Your records stay in your workspace</span></div><div className="login-orbit"><div className="graphic-ring ring-one"/><div className="graphic-ring ring-two"/><div className="graphic-center"><Wallet size={38}/></div></div></section>
      <section className="login-card"><div className="login-card-icon"><BrainCircuit size={21}/></div><div className="overline">PERSONAL WORKSPACE</div><h2>{signingUp?"Create your account":"Welcome back"}</h2><p>{signingUp?"Create a private workspace for your finances.":"Sign in to continue to FinPilot."}</p>{error&&<div className="login-error" role="alert">{error}</div>}<form onSubmit={onSubmit}><label className="login-field"><span>Email or username</span><input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required minLength={3} maxLength={80}/></label><label className="login-field"><span>Password{signingUp?" (at least 8 characters)":""}</span><input type="password" autoComplete={signingUp?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} required minLength={signingUp?8:1} maxLength={200}/></label>{signingUp&&<label className="login-field"><span>Confirm password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required minLength={8} maxLength={200}/></label>}<button className="primary" disabled={busy||!service.ok||!service.loginConfigured}>{busy?<><LoaderCircle size={16} className="spin"/> {signingUp?"Creating account…":"Signing in…"}</>:signingUp?"Create account":"Sign in to workspace"}</button>{!service.ok&&<small className="login-help">The API must be running to sign in. Start the backend and try again.</small>}{service.ok&&!service.loginConfigured&&<small className="login-help">Session settings are not loaded. Set SESSION_SECRET in backend/.env and restart the backend.</small>}</form><div className="auth-switch">{signingUp?"Already have an account?":"New to FinPilot?"}<button type="button" className="link-button" onClick={()=>setMode(signingUp?"login":"signup")}>{signingUp?"Sign in":"Create an account"}</button></div><div className="login-foot"><span><span className="status-dot"/> Private session</span><span>Sessions expire after 12 hours</span></div></section></main><footer className="login-footer">FinPilot · Personal finance workspace</footer></div>;
}
