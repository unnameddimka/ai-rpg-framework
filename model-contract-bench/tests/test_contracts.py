import json, sqlite3, unittest
from pathlib import Path
from bench.db import connect, row_case
from bench.contracts import validate_response

ROOT=Path(__file__).resolve().parents[1]
class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.db=connect(ROOT/'bench.sqlite3')
    @classmethod
    def tearDownClass(cls): cls.db.close()
    def test_historical_final_outputs_validate_when_clean(self):
        rows=self.db.execute("""SELECT c.*,r.raw_response,r.clean_pass,r.repaired_pass,r.finish_reason FROM cases c JOIN runs r ON r.case_id=c.id WHERE r.run_kind='historical' AND r.status='pass'""").fetchall()
        failures=[]
        for r in rows:
            case=row_case(r)
            vr=validate_response(case,r['raw_response'] or '',finish_reason=None)
            if not vr.passed: failures.append((r['id'],r['stage'],vr.category,vr.message))
        self.assertEqual([],failures)
    def test_known_historical_truncation_present(self):
        n=self.db.execute("SELECT count(*) FROM runs WHERE run_kind='historical' AND failure_category='truncation'").fetchone()[0]
        self.assertGreaterEqual(n,1)
if __name__=='__main__': unittest.main()
