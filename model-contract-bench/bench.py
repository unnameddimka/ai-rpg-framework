from __future__ import annotations
import argparse, os
from pathlib import Path
from bench.db import connect
from bench.importer import import_dump, export_corpus_jsonl
from bench.server import serve
from bench.runner import run_one

DEFAULT_DB = str(Path(__file__).with_name("bench.sqlite3"))

def main():
    p=argparse.ArgumentParser(description="Standalone LLM contract benchmark from captured application requests")
    p.add_argument("--db",default=DEFAULT_DB)
    sub=p.add_subparsers(dest="cmd",required=True)
    imp=sub.add_parser("import-dump"); imp.add_argument("dump"); imp.add_argument("--all",action="store_true"); imp.add_argument("--no-historical",action="store_true")
    exp=sub.add_parser("export-corpus"); exp.add_argument("path",nargs="?",default="corpus/seed-v1.jsonl")
    srv=sub.add_parser("serve"); srv.add_argument("--host",default="127.0.0.1"); srv.add_argument("--port",type=int,default=8765)
    run=sub.add_parser("run"); run.add_argument("model"); run.add_argument("--role",choices=["utility","character","narrator","all"],default="all"); run.add_argument("--repetitions",type=int,default=1); run.add_argument("--force",action="store_true")
    args=p.parse_args(); con=connect(args.db)
    if args.cmd=="import-dump":
        print(import_dump(con,args.dump,seed_only=not args.all,include_historical_runs=not args.no_historical))
    elif args.cmd=="export-corpus":
        export_corpus_jsonl(con,args.path); print(args.path)
    elif args.cmd=="serve":
        con.close(); serve(args.db,args.host,args.port)
    elif args.cmd=="run":
        key=os.environ.get("OPENROUTER_API_KEY");
        if not key: raise SystemExit("Set OPENROUTER_API_KEY first")
        q="SELECT id FROM cases WHERE selected=1"; vals=[]
        if args.role!="all": q+=" AND role=?"; vals=[args.role]
        ids=[r[0] for r in con.execute(q+" ORDER BY role,stage,input_chars",vals)]
        for cid in ids:
            for rep in range(1,args.repetitions+1):
                r=run_one(con,cid,args.model,key,rep,force=args.force); print(cid,rep,"CACHED" if r.get("cached") else r.get("status"),r.get("failure_category") or "")

if __name__=="__main__": main()
