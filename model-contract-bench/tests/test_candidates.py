import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class CandidateRegistryTests(unittest.TestCase):
    def test_registry_has_ten_unique_models(self):
        data = json.loads((ROOT / "models-to-test.json").read_text(encoding="utf-8"))
        models = data["models"]
        self.assertEqual(10, len(models))
        ids = [m["model_id"] for m in models]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(list(range(1, 11)), [m["priority"] for m in models])
        for m in models:
            self.assertGreater(m["context_tokens"], 0)
            self.assertGreaterEqual(m["input_per_m"], 0)
            self.assertGreaterEqual(m["output_per_m"], 0)
            self.assertIn(m["focus"], {"utility", "character", "both"})

if __name__ == "__main__":
    unittest.main()
