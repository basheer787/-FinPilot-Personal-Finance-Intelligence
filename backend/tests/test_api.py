import os
import uuid
from pathlib import Path
from fastapi.testclient import TestClient

# Isolate each test run from the user's actual local database.
os.environ["SQLITE_PATH"] = str(Path(__file__).parent / "test-finpilot.db")
os.environ.pop("GEMINI_API_KEY", None)
os.environ["APP_LOGIN_USERNAME"] = "demo"
os.environ["APP_LOGIN_PASSWORD"] = "test-password"
os.environ["SESSION_SECRET"] = "test-secret-for-api-tests-1234567890"

import main

client = TestClient(main.app)
token = client.post("/api/auth/login", json={"username":"demo","password":"test-password"}).json()["token"]
client.headers.update({"Authorization": f"Bearer {token}"})


def setup_function():
    with main.connect() as con:
        con.execute("DELETE FROM transactions")
        con.execute("DELETE FROM goals")
        con.execute("DELETE FROM budgets")
        con.execute("DELETE FROM insights")


def test_health_and_root():
    assert client.get("/").status_code == 200
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["databaseType"] == "SQLite"


def test_financial_endpoints_require_a_valid_login():
    unauthenticated = TestClient(main.app)
    assert unauthenticated.get("/api/transactions").status_code == 401
    bad_login = unauthenticated.post("/api/auth/login", json={"username":"demo","password":"wrong"})
    assert bad_login.status_code == 401
    good_login = unauthenticated.post("/api/auth/login", json={"username":"demo","password":"test-password"})
    assert good_login.status_code == 200
    assert good_login.json()["token"]


def test_signup_creates_private_workspace_and_hashes_password():
    username = f"tester-{uuid.uuid4().hex[:10]}"
    created = client.post("/api/auth/signup", json={"username":username,"password":"strong-test-password"})
    assert created.status_code == 201, created.text
    user_token = created.json()["token"]
    with main.connect() as con:
        user = con.execute("SELECT id,passwordHash FROM users WHERE username=?", (username,)).fetchone()
    assert user and user["passwordHash"] != "strong-test-password"
    own = client.post("/api/transactions", json={"transaction":{
        "amount":125,"currency":"INR","merchant":"Test","category":"Food",
        "transactionDate":"2026-10-28","paymentMethod":"Cash","note":"Test meal","transactionType":"expense"
    }}, headers={"Authorization":f"Bearer {user_token}"})
    assert own.status_code == 201, own.text
    other = client.get("/api/transactions")
    assert other.status_code == 200
    assert all(tx["merchant"] != "Test" for tx in other.json()["transactions"])
    assert client.post("/api/auth/signup", json={"username":username,"password":"strong-test-password"}).status_code == 409


def test_transaction_draft_is_not_saved_until_confirmed():
    draft = client.post("/api/transactions/extract", json={
        "input": "I spent 450 rupees on lunch at Green Bowl today using UPI."
    })
    assert draft.status_code == 200, draft.text
    tx = draft.json()["transaction"]
    assert tx["amount"] == 450
    assert tx["category"] == "Food"
    assert tx["merchant"] and "Green Bowl" in tx["merchant"]
    assert client.get("/api/transactions").json()["transactions"] == []
    saved = client.post("/api/transactions", json={
        "transaction": tx, "originalInput": "I spent 450 rupees on lunch at Green Bowl today using UPI."
    })
    assert saved.status_code == 201, saved.text
    assert len(client.get("/api/transactions").json()["transactions"]) == 1


def test_goal_plan_and_save():
    plan = client.post("/api/goals/plan", json={"input": "Save ₹30000 for a laptop in 6 months"})
    assert plan.status_code == 200, plan.text
    goal = plan.json()["goal"]
    assert goal["targetAmount"] == 30000
    assert goal["deadline"]
    assert len(goal["milestones"]) >= 1
    saved = client.post("/api/goals", json={"goal": goal})
    assert saved.status_code == 201, saved.text
    assert len(client.get("/api/goals").json()["goals"]) == 1


def test_budget_and_monthly_insights():
    tx = client.post("/api/transactions/extract", json={
        "input": "I spent 450 rupees on lunch at Green Bowl today using UPI."
    }).json()["transaction"]
    assert client.post("/api/transactions", json={"transaction": tx}).status_code == 201
    budget = client.put("/api/budgets", json={"category": "Food", "monthlyLimit": 5000})
    assert budget.status_code == 200, budget.text
    food = next(b for b in client.get("/api/budgets").json()["budgets"] if b["category"] == "Food")
    assert food["monthlyLimit"] == 5000
    assert food["spent"] == 450
    month = tx["transactionDate"][:7]
    insights = client.post("/api/insights/monthly", json={"month": month})
    assert insights.status_code == 200, insights.text
    assert insights.json()["insights"]["transactionsAnalyzed"] == 1


def test_invalid_budget_category_rejected():
    response = client.put("/api/budgets", json={"category": "Invalid", "monthlyLimit": 500})
    assert response.status_code == 400
