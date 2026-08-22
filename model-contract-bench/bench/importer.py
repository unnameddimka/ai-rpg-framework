from __future__ import annotations
import hashlib, json, zipfile
from pathlib import Path
from typing import Any
from .db import canonical_hash
from .contracts import CONTRACT_VERSION, validate_response


def infer_role(request: dict[str, Any]) -> str:
    opts = request.get("requestOptions") or {}
    role = opts.get("modelRole")
    if role in {"utility", "character", "narrator"}:
        return role
    purpose = request.get("purpose")
    if purpose in {"game-decision", "daytime-job-narration", "daytime-job-settlement"}:
        return "character"
    if purpose in {"weather-narration"}:
        return "narrator"
    return "utility"

def size_bucket(prompt_tokens: int | None, input_chars: int) -> str:
    # Use historical provider token count when available; chars are the fallback.
    if prompt_tokens is not None:
        if prompt_tokens < 4_000: return "small"
        if prompt_tokens < 10_000: return "medium"
        if prompt_tokens < 20_000: return "large"
        return "near-limit"
    if input_chars < 16_000: return "small"
    if input_chars < 40_000: return "medium"
    if input_chars < 80_000: return "large"
    return "near-limit"

def _request_chars(request: dict[str, Any]) -> int:
    return sum(len(str(m.get("content", ""))) for m in request.get("messages", []))

def _source_fingerprint(path: Path, manifest: dict[str, Any]) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()

def _historical_failure(result: dict[str, Any]) -> str | None:
    if result.get("ok"):
        return None
    err = result.get("error") or {}
    code = str(err.get("code") or "")
    if "TRUNCAT" in code or "TOKEN" in code:
        return "truncation"
    if err.get("status"):
        return "provider_error"
    return "historical_failure"

def choose_seed_exchange_ids(entries: list[dict[str, Any]]) -> set[int]:
    # Small but coverage-complete: min/median/max request size for every role+stage.
    groups: dict[tuple[str,str], list[tuple[int,int]]] = {}
    for e in entries:
        req = e.get("request") or {}
        role, stage = infer_role(req), str(req.get("stage") or req.get("purpose") or "unknown")
        groups.setdefault((role, stage), []).append((_request_chars(req), int(e["id"])))
    chosen: set[int] = set()
    for rows in groups.values():
        rows.sort()
        for idx in {0, len(rows)//2, len(rows)-1}:
            chosen.add(rows[idx][1])
    # Preserve known interesting engine outcomes when present.
    for e in entries:
        result = e.get("result") or {}
        if not result.get("ok") or result.get("repaired"):
            chosen.add(int(e["id"]))
    return chosen

def import_dump(db, dump_path: str | Path, *, seed_only: bool = True, include_historical_runs: bool = True) -> dict[str, Any]:
    path = Path(dump_path)
    with zipfile.ZipFile(path) as z:
        manifest = json.loads(z.read("manifest.json"))
        exchanges_doc = json.loads(z.read("ai-exchanges.json"))
    entries = exchanges_doc.get("entries") or []
    fp = _source_fingerprint(path, manifest)
    db.execute("INSERT OR IGNORE INTO sources(fingerprint,name,metadata_json) VALUES(?,?,?)", (fp, path.name, json.dumps(manifest, ensure_ascii=False)))
    source_id = db.execute("SELECT id FROM sources WHERE fingerprint=?", (fp,)).fetchone()[0]
    selected_ids = choose_seed_exchange_ids(entries) if seed_only else {int(e["id"]) for e in entries}
    inserted = 0; historical = 0
    for e in entries:
        if int(e["id"]) not in selected_ids: continue
        req = e.get("request") or {}
        result = e.get("result") or {}
        role = infer_role(req)
        stage = str(req.get("stage") or req.get("purpose") or "unknown")
        prompt_tokens = (result.get("usage") or {}).get("prompt_tokens")
        chars = _request_chars(req)
        case_id = f"dump-{manifest.get('exportedAt','unknown')[:10]}-x{e['id']}"
        r_hash = canonical_hash({"messages": req.get("messages"), "requestOptions": req.get("requestOptions"), "stage": stage})
        opts = req.get("requestOptions") or {}
        db.execute("""INSERT OR IGNORE INTO cases(id,source_id,exchange_id,role,purpose,stage,profile,request_json,request_hash,input_chars,original_prompt_tokens,original_model,size_bucket,selected,contract_version)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (case_id,source_id,int(e["id"]),role,req.get("purpose"),stage,opts.get("profile"),json.dumps(req,ensure_ascii=False),r_hash,chars,prompt_tokens,req.get("modelId"),size_bucket(prompt_tokens,chars),1,CONTRACT_VERSION))
        if db.total_changes: inserted += 1
        if include_historical_runs:
            raw = result.get("rawContent")
            provider = None; finish = None
            trace = result.get("trace") or {}
            attempts = trace.get("attempts") or []
            if attempts:
                pr = (attempts[-1].get("providerResponse") or {}).get("parsedBody") or {}
                provider = pr.get("provider")
                choices = pr.get("choices") or []
                if choices: finish = choices[0].get("finish_reason")
            # Historical result tells us whether engine accepted cleanly or after repair.
            ok = bool(result.get("ok")); repaired = bool(result.get("repaired"))
            failure = _historical_failure(result)
            settings_hash = canonical_hash({"historical": True, "requestOptions": req.get("requestOptions")})
            db.execute("""INSERT OR IGNORE INTO runs(case_id,model_id,provider,run_kind,repetition,settings_hash,contract_version,duration_ms,status,clean_pass,repaired_pass,failure_category,validation_error,raw_response,finish_reason,prompt_tokens,completion_tokens,total_tokens,cost,response_json)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                       (case_id, req.get("modelId") or "unknown", provider, "historical", 1, settings_hash, CONTRACT_VERSION, e.get("durationMs"), "pass" if ok else "fail", 1 if ok and not repaired else 0, 1 if ok and repaired else 0, failure, json.dumps(result.get("error"),ensure_ascii=False) if result.get("error") else None, raw, finish, (result.get("usage") or {}).get("prompt_tokens"), (result.get("usage") or {}).get("completion_tokens"), (result.get("usage") or {}).get("total_tokens"), (result.get("usage") or {}).get("cost"), json.dumps(result,ensure_ascii=False)))
            historical += 1
    db.commit()
    return {"source": path.name, "source_id": source_id, "entries": len(entries), "selected": len(selected_ids), "historical_runs_considered": historical}

def export_corpus_jsonl(db, path: str | Path):
    out = Path(path)
    rows = db.execute("SELECT * FROM cases WHERE selected=1 ORDER BY role,stage,input_chars").fetchall()
    with out.open("w", encoding="utf-8") as f:
        for r in rows:
            d = dict(r); d["request"] = json.loads(d.pop("request_json")); f.write(json.dumps(d,ensure_ascii=False)+"\n")
