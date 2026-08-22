from __future__ import annotations
import json, sqlite3, hashlib
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

DDL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cases(
  id TEXT PRIMARY KEY,
  source_id INTEGER REFERENCES sources(id),
  exchange_id INTEGER,
  role TEXT NOT NULL,
  purpose TEXT,
  stage TEXT NOT NULL,
  profile TEXT,
  request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  input_chars INTEGER NOT NULL,
  original_prompt_tokens INTEGER,
  original_model TEXT,
  size_bucket TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 1,
  contract_version TEXT NOT NULL,
  UNIQUE(source_id, exchange_id)
);
CREATE INDEX IF NOT EXISTS idx_cases_role_stage ON cases(role, stage);
CREATE TABLE IF NOT EXISTS runs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  provider TEXT,
  run_kind TEXT NOT NULL DEFAULT 'benchmark',
  repetition INTEGER NOT NULL DEFAULT 1,
  settings_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  clean_pass INTEGER NOT NULL DEFAULT 0,
  repaired_pass INTEGER NOT NULL DEFAULT 0,
  failure_category TEXT,
  validation_error TEXT,
  raw_response TEXT,
  repaired_response TEXT,
  finish_reason TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost REAL,
  response_json TEXT,
  UNIQUE(case_id, model_id, settings_hash, contract_version, repetition, run_kind)
);
CREATE INDEX IF NOT EXISTS idx_runs_model ON runs(model_id);
CREATE INDEX IF NOT EXISTS idx_runs_case ON runs(case_id);
"""

def connect(path: str | Path) -> sqlite3.Connection:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(p)
    db.row_factory = sqlite3.Row
    db.executescript(DDL)
    db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),))
    db.commit()
    return db

def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()

def row_case(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["request"] = json.loads(d.pop("request_json"))
    return d
