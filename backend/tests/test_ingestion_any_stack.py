"""
Tests for generalizing auth/table-usage/API-call detection past the one
Supabase-shaped repo they were originally built against (see
test_ingestion_coverage_gaps.py) — Python auth libraries, Python
requests/httpx calls, SQLAlchemy/Django/Mongoose ORM models, and
dedicated JS/TS auth-provider imports.
"""
from __future__ import annotations

from pathlib import Path

from app.services.ingestion_discovery import discover_files
from app.services.ingestion_extract import extract_evidence


def _write(root: Path, rel_path: str, content: str) -> None:
    path = root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


# --- Python auth libraries ---------------------------------------------

def test_flask_login_import_produces_auth_usage(tmp_path: Path):
    _write(tmp_path, "app.py", "from flask_login import LoginManager, login_user\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "auth_usage"]
    assert len(matches) == 1
    assert "Flask-Login" in matches[0].detail


def test_pyjwt_import_produces_auth_usage(tmp_path: Path):
    _write(tmp_path, "auth.py", "import jwt\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    assert any(e.fact == "auth_usage" and "PyJWT" in e.detail for e in evidence)


def test_django_contrib_auth_import_produces_auth_usage(tmp_path: Path):
    """django.contrib.auth needed its own special case -- its top-level
    import segment ("django") is already claimed by the web-framework
    entry, so a plain top-level dict lookup alone would never catch it."""
    _write(tmp_path, "views.py", "from django.contrib.auth import authenticate, login\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "auth_usage"]
    assert len(matches) == 1
    assert "django.contrib.auth" in matches[0].detail
    # the web_framework fact for plain "django" must still fire too -- the
    # special case is additive, not a replacement
    assert any(e.fact == "web_framework" and "Django" in e.detail for e in evidence)


# --- Python third-party API calls ---------------------------------------

def test_requests_call_to_known_host_produces_third_party_api_call(tmp_path: Path):
    _write(tmp_path, "notify.py", "requests.post('https://api.stripe.com/v1/charges', data={})\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "third_party_api_call"]
    assert len(matches) == 1
    assert "Stripe" in matches[0].detail


def test_httpx_call_to_known_host_produces_third_party_api_call(tmp_path: Path):
    _write(tmp_path, "notify.py", "httpx.get('https://api.openai.com/v1/chat/completions')\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "third_party_api_call"]
    assert len(matches) == 1
    assert "OpenAI" in matches[0].detail


def test_requests_call_to_unrecognized_host_produces_no_evidence(tmp_path: Path):
    _write(tmp_path, "misc.py", "requests.get('https://internal-service.example.com/health')\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    assert not any(e.fact == "third_party_api_call" for e in evidence)


def test_session_get_is_not_attributed_since_no_data_flow_is_tracked(tmp_path: Path):
    """Deliberate scope limit, not a bug: a call through a pre-built
    client instance isn't attempted, only module-level requests.*/
    httpx.* calls."""
    _write(tmp_path, "client.py", "session.get('https://api.stripe.com/v1/charges')\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    assert not any(e.fact == "third_party_api_call" for e in evidence)


# --- Python ORM models ---------------------------------------------------

def test_sqlalchemy_model_with_tablename_produces_database_schema(tmp_path: Path):
    _write(tmp_path, "models.py", """\
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = None
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "database_schema"]
    assert len(matches) == 1
    assert "users" in matches[0].detail
    assert "defined" in matches[0].detail


def test_sqlalchemy_model_without_tablename_is_honestly_uncertain(tmp_path: Path):
    _write(tmp_path, "models.py", """\
class Order(Base):
    id = None
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "database_schema"]
    assert len(matches) == 1
    assert "Order" in matches[0].detail
    assert "not determined" in matches[0].detail


def test_flask_sqlalchemy_db_model_base_is_recognized(tmp_path: Path):
    _write(tmp_path, "models.py", """\
class Product(db.Model):
    __tablename__ = "products"
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "database_schema"]
    assert len(matches) == 1
    assert "products" in matches[0].detail


def test_django_model_is_recognized(tmp_path: Path):
    _write(tmp_path, "models.py", "class Voter(models.Model):\n    pass\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "database_schema"]
    assert len(matches) == 1
    assert "Voter" in matches[0].detail
    assert "Django" in matches[0].detail


def test_unrelated_class_is_not_misreported_as_an_orm_model(tmp_path: Path):
    _write(tmp_path, "utils.py", "class Helper:\n    pass\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    assert not any(e.fact == "database_schema" for e in evidence)


# --- JS/TS auth providers + Mongoose --------------------------------------

def test_next_auth_import_produces_auth_provider_dependency(tmp_path: Path):
    _write(tmp_path, "src/auth.ts", "import NextAuth from 'next-auth';\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "auth_provider_dependency"]
    assert len(matches) == 1
    assert "NextAuth" in matches[0].detail


def test_clerk_import_produces_auth_provider_dependency(tmp_path: Path):
    _write(tmp_path, "src/app.tsx", "import { ClerkProvider } from '@clerk/nextjs';\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "auth_provider_dependency"]
    assert len(matches) == 1
    assert "Clerk" in matches[0].detail


def test_firebase_auth_submodule_produces_auth_usage_distinct_from_generic_firebase(tmp_path: Path):
    """firebase/auth is a stronger, more specific signal than the bare
    "firebase" import -- both should fire, not just one."""
    _write(tmp_path, "src/firebase.ts", """\
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    assert any(e.fact == "firebase_dependency" for e in evidence)
    assert any(e.fact == "auth_usage" and "Firebase Auth" in e.detail for e in evidence)


def test_mongoose_model_produces_database_schema(tmp_path: Path):
    _write(tmp_path, "src/models/user.js", """\
const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({ name: String });
module.exports = mongoose.model('User', userSchema);
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "database_schema"]
    assert len(matches) == 1
    assert "User" in matches[0].detail
    assert "Mongoose" in matches[0].detail


# --- End-to-end: a non-Supabase, non-JS stack in one pass -----------------

def test_a_flask_sqlalchemy_stripe_repo_gets_real_depth_too(tmp_path: Path):
    """The actual point of this whole file: a completely different stack
    (Flask + SQLAlchemy + Flask-Login + Stripe via requests) gets the
    same depth of evidence the Supabase/React repo did, not because it's
    a special case, but because the underlying patterns generalize."""
    _write(tmp_path, "app.py", """\
from flask import Flask
from flask_login import LoginManager
import requests

app = Flask(__name__)

@app.route('/checkout', methods=['POST'])
def checkout():
    requests.post('https://api.stripe.com/v1/charges', data={})
    return 'ok'
""")
    _write(tmp_path, "models.py", """\
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class Order(Base):
    __tablename__ = "orders"
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    facts = {e.fact for e in evidence}

    assert "web_framework" in facts  # Flask
    assert "auth_usage" in facts  # Flask-Login
    assert "third_party_api_call" in facts  # Stripe, via requests
    assert "database_schema" in facts  # the SQLAlchemy Order model
