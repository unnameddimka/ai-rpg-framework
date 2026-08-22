from __future__ import annotations
import json, mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from .db import connect
from .runner import run_one


def _summary(con, kind: str):
    rows=con.execute("""SELECT r.model_id,c.role,c.stage,c.size_bucket,r.clean_pass,r.repaired_pass,r.status,r.failure_category,r.duration_ms,r.cost
                        FROM runs r JOIN cases c ON c.id=r.case_id WHERE r.run_kind=?""",(kind,)).fetchall()
    models={}
    for rr in rows:
        r=dict(rr)
        m=models.setdefault(r["model_id"], {"model_id":r["model_id"],"roles":{},"total":0,"clean":0,"repaired":0,"fails":{},"cost":0.0,"durations":[]})
        m["total"]+=1; m["clean"]+=r["clean_pass"]; m["repaired"]+=r["repaired_pass"]
        if r["failure_category"]: m["fails"][r["failure_category"]]=m["fails"].get(r["failure_category"],0)+1
        if r["cost"] is not None: m["cost"]+=r["cost"]
        if r["duration_ms"] is not None: m["durations"].append(r["duration_ms"])
        role=m["roles"].setdefault(r["role"],{"total":0,"clean":0,"repaired":0}); role["total"]+=1; role["clean"]+=r["clean_pass"]; role["repaired"]+=r["repaired_pass"]
    out=[]
    for m in models.values():
        for role in m["roles"].values(): role["clean_rate"]=100*role["clean"]/role["total"] if role["total"] else None
        primary=[m["roles"].get(x,{}).get("clean_rate") for x in ("utility","character")]; primary=[x for x in primary if x is not None]
        m["sort_score"]=sum(primary)/len(primary) if primary else 0
        m["clean_rate"]=100*m["clean"]/m["total"] if m["total"] else 0
        m["avg_duration_ms"]=round(sum(m["durations"])/len(m["durations"])) if m["durations"] else None
        del m["durations"]; out.append(m)
    out.sort(key=lambda x:(-x["sort_score"],x["model_id"]))
    return out


def handler_factory(db_path: str, static_dir: str):
    root=Path(static_dir).resolve()
    project_root=Path(__file__).resolve().parent.parent
    class Handler(BaseHTTPRequestHandler):
        server_version="ModelContractBench/0.2"
        def log_message(self, fmt, *args):
            print(f"[{self.log_date_time_string()}] {fmt % args}")
        def _json(self, obj, status=200):
            data=json.dumps(obj,ensure_ascii=False).encode("utf-8")
            self.send_response(status); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Content-Length",str(len(data))); self.end_headers(); self.wfile.write(data)
        def _read_json(self):
            n=int(self.headers.get("Content-Length","0")); return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
        def _static(self, rel):
            p=(root/rel).resolve()
            if root not in p.parents and p!=root: self.send_error(403); return
            if not p.is_file(): self.send_error(404); return
            data=p.read_bytes(); ctype=mimetypes.guess_type(str(p))[0] or "application/octet-stream"
            self.send_response(200); self.send_header("Content-Type",ctype); self.send_header("Content-Length",str(len(data))); self.end_headers(); self.wfile.write(data)
        def do_GET(self):
            u=urlparse(self.path); qs=parse_qs(u.query)
            if u.path=="/": return self._static("index.html")
            if u.path.startswith("/static/"): return self._static(u.path[len("/static/"):])
            con=connect(db_path)
            try:
                if u.path=="/api/cases":
                    rows=con.execute("SELECT id,exchange_id,role,purpose,stage,profile,input_chars,original_prompt_tokens,original_model,size_bucket,selected FROM cases ORDER BY role,stage,input_chars").fetchall(); return self._json([dict(r) for r in rows])
                if u.path=="/api/candidates":
                    path=project_root/"models-to-test.json"
                    if not path.is_file(): return self._json({"models":[]})
                    return self._json(json.loads(path.read_text(encoding="utf-8")))
                if u.path=="/api/summary": return self._json(_summary(con,(qs.get("kind") or ["benchmark"])[0]))
                if u.path=="/api/results":
                    kind=(qs.get("kind") or ["benchmark"])[0]; model=(qs.get("model") or [None])[0]
                    q="""SELECT r.*,c.role,c.stage,c.size_bucket,c.exchange_id FROM runs r JOIN cases c ON c.id=r.case_id WHERE r.run_kind=?"""; args=[kind]
                    if model: q+=" AND r.model_id=?"; args.append(model)
                    q+=" ORDER BY r.model_id,c.role,c.stage,c.input_chars,r.repetition"
                    return self._json([dict(r) for r in con.execute(q,args).fetchall()])
                self.send_error(404)
            finally: con.close()
        def do_POST(self):
            u=urlparse(self.path)
            if u.path!="/api/run-one": self.send_error(404); return
            try: body=self._read_json()
            except Exception as e: self._json({"error":f"invalid JSON: {e}"},400); return
            if not body.get("apiKey") or not body.get("modelId") or not body.get("caseId"):
                self._json({"error":"apiKey, modelId and caseId are required"},400); return
            con=connect(db_path)
            try:
                result=run_one(con,body["caseId"],body["modelId"],body["apiKey"],int(body.get("repetition",1)),force=bool(body.get("force")))
                self._json(result)
            except Exception as e: self._json({"error":str(e)},500)
            finally: con.close()
    return Handler


def serve(db_path: str, host: str="127.0.0.1", port: int=8765, static_dir: str | None=None):
    root=static_dir or str(Path(__file__).resolve().parent.parent/"static")
    httpd=ThreadingHTTPServer((host,port),handler_factory(db_path,root))
    print(f"Model Contract Bench: http://{host}:{port}")
    try: httpd.serve_forever()
    except KeyboardInterrupt: pass
    finally: httpd.server_close()
