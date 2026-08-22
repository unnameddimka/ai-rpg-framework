from __future__ import annotations
import json
from .contracts import CONTRACT_VERSION, validate_response
from .db import canonical_hash, row_case
from .openrouter import call, payload_for_case


def settings_hash(case: dict, model_id: str) -> str:
    p = payload_for_case(case, model_id).copy(); p.pop("messages", None)
    return canonical_hash(p)

def run_one(db, case_id: str, model_id: str, api_key: str, repetition: int = 1, *, force: bool = False) -> dict:
    row = db.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone()
    if not row: raise KeyError(case_id)
    case = row_case(row)
    sh = settings_hash(case, model_id)
    existing = db.execute("SELECT * FROM runs WHERE case_id=? AND model_id=? AND settings_hash=? AND contract_version=? AND repetition=? AND run_kind='benchmark'", (case_id,model_id,sh,CONTRACT_VERSION,repetition)).fetchone()
    if existing and not force: return {"cached": True, **dict(existing)}
    if existing and force: db.execute("DELETE FROM runs WHERE id=?", (existing["id"],)); db.commit()
    cr = call(case, model_id, api_key)
    if not cr.ok:
        vr_pass=False; category=cr.category; message=cr.error; parsed=None
    else:
        vr = validate_response(case, cr.raw or "", finish_reason=cr.finish_reason)
        vr_pass=vr.passed; category=vr.category; message=vr.message; parsed=vr.parsed
    u = cr.usage or {}
    db.execute("""INSERT INTO runs(case_id,model_id,provider,run_kind,repetition,settings_hash,contract_version,duration_ms,status,clean_pass,repaired_pass,failure_category,validation_error,raw_response,finish_reason,prompt_tokens,completion_tokens,total_tokens,cost,response_json)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
               (case_id,model_id,cr.provider,"benchmark",repetition,sh,CONTRACT_VERSION,cr.duration_ms,"pass" if vr_pass else "fail",1 if vr_pass else 0,0,None if vr_pass else category,None if vr_pass else message,cr.raw,cr.finish_reason,u.get("prompt_tokens"),u.get("completion_tokens"),u.get("total_tokens"),u.get("cost"),json.dumps(cr.response_json,ensure_ascii=False) if cr.response_json else None))
    db.commit()
    rid=db.execute("SELECT last_insert_rowid()").fetchone()[0]
    return {"cached": False, **dict(db.execute("SELECT * FROM runs WHERE id=?",(rid,)).fetchone())}
