# FinPilot — Personal Finance Intelligence

FinPilot is a full-stack finance assistant. It turns unstructured text, browser speech, and receipt files into structured records; asks the user to review drafts; and persists approved data in SQLite.

## Features mapped to the project brief

1. **Spoken expense → ledger:** click **Speak expense**, allow microphone access, review the transcript, extract the transaction, edit the schema fields, then click **Confirm & save**. Speech recognition is browser-dependent; Chrome on localhost is recommended.
2. **Receipt → draft:** upload a JPG, PNG, WEBP, or PDF. Gemini reads the receipt and proposes amount, date, merchant, category, payment method, and note. It is not saved until the user confirms. This feature requires a valid Gemini API key and model access.
3. **Savings goal → milestones:** enter a goal such as “Save ₹30,000 for a laptop in 6 months.” Review target, deadline, monthly saving and milestones, then confirm to persist it.
4. **Spending categories and budgets:** transaction extraction classifies spending into the defined category enum. Budget limits persist in SQLite; the app computes current-month spending per category from saved, dated expense transactions.
5. **Monthly patterns and actions:** select a month to analyze dated transactions. Gemini is used when available; a deterministic summary fallback is provided when Gemini is missing or unavailable. Suggestions are advisory and never modify budgets/goals automatically.

## Technology
- Frontend: React + Vite + lucide-react
- Backend: Python + FastAPI + Pydantic schema validation
- Database: SQLite (no external database service or database credentials required)
- AI: Google Gemini API (optional for most text workflows; required for image/PDF receipt extraction)

## Windows setup

From the extracted project folder, open two VS Code terminals.

### 1. Backend

```bat
cd backend
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
copy .env.example .env
```

Edit `backend/.env` after copying the example and set a random `SESSION_SECRET` with at least 32 characters. Generate one with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. New users can create an account from the sign-up page. Add your own Gemini key to `GEMINI_API_KEY` to enable generative extraction, receipt reading, and monthly insights. The example model is `gemini-3.8-flash`; choose a model ID available to your own API key if needed. Never share or commit `.env`.

Sign-up creates a separate account; passwords are stored as salted PBKDF2 hashes and all financial records are scoped to the account in the signed 12-hour session. If `SESSION_SECRET` is missing or shorter than 32 characters, the API refuses sign-in and sign-up.

### Render deployment

The root `render.yaml` defines a FastAPI service, a React static site, a persistent disk for SQLite, and secret prompts for the session secret and Gemini API key. To deploy, push this folder to a Git provider repository, then create a **Blueprint** from that repository in Render. Render generates `SESSION_SECRET`; users then create their own accounts from the sign-up page. The blueprint uses a persistent disk for the database; persistent storage requires a paid Render web service. Render needs the repository and your account authorization, so the live deployment URL is not created from this local workspace. Once deployment succeeds, add its public frontend URL to `REPORT.md`.

If Render assigns a suffixed hostname because the default service names are already in use, update the frontend `VITE_API_URL` to the API hostname and the API `CLIENT_ORIGIN` to the frontend URL in the Render dashboard, then redeploy both services. Never commit `.env`, a database file, an API key, or a login password.

Start the API:

```bat
uvicorn main:app --reload --host 127.0.0.1 --port 5000
```

Keep this terminal running. Open these endpoints to verify:
- `http://127.0.0.1:5000/` — API status (should return JSON, not “Cannot GET /”)
- `http://127.0.0.1:5000/api/health` — database and AI configuration status
- `http://127.0.0.1:5000/docs` — interactive API documentation

### 2. Frontend

Open a second terminal:

```bat
cd frontend
npm install
npm run dev
```

Open the exact URL printed by Vite (usually `http://localhost:5173`). The backend CORS allowlist includes localhost/127.0.0.1 ports 5173 and 5174. If Vite chooses another port, add that exact origin to `CLIENT_ORIGIN` in `backend/.env` and restart the backend.

## Run automated backend tests

In a backend terminal with `.venv` active:

```bat
python -m pytest -q
```

The tests check API health, draft-vs-save behavior, transaction classification, goal planning and persistence, budget totals, monthly insights, and invalid category rejection. Tests use a separate test database.

## API overview
- `POST /api/transactions/extract` — validate natural-language transaction into a draft; does not save it
- `POST /api/transactions` — save a user-reviewed transaction
- `GET /api/transactions` — ledger
- `GET /api/summary` — income, expenses, balance and category totals
- `POST /api/receipts/extract` — multimodal receipt extraction into a draft
- `POST /api/goals/plan` — produce a goal plan draft
- `POST /api/goals` / `GET /api/goals` — save/list goals
- `GET /api/budgets` / `PUT /api/budgets` — budget limits and current-month spend
- `POST /api/insights/monthly` — month summary, patterns and action items

## Important notes
- A successful local fallback keeps core text workflows usable if Gemini is not configured or temporarily fails; it is rule-based, not a generative response. Receipt extraction specifically requires Gemini.
- If the API is running but the UI cannot connect, check that the backend terminal is still running and that the browser URL's port matches `CLIENT_ORIGIN`.
- Do not run two backend servers on port 5000 simultaneously. Stop an existing one with Ctrl+C before starting another.
- The database file is local and persists between restarts. Delete `backend/finpilot.db` only if you intentionally want to reset your local data.
- This is an educational tracker, not financial advice. No real bank account is connected.
