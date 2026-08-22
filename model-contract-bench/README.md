# Model Contract Bench

Standalone benchmark for replaying captured LLM requests and measuring **contract reliability**, not prose similarity.

The first corpus comes from one real Emergency Dump. The application itself has no runtime dependency on Mallowstead: cases are immutable captured requests plus a local contract validator profile.

## What it measures

Primary metric: **clean contract pass rate** — the first model response is accepted by the benchmark validator without repair.

Results are kept separate by model role:

- `utility`
- `character`
- `narrator` (supported, but not included in the primary sort score)

The overall **Sort score** is only the arithmetic mean of available Utility and Character clean-pass rates. It exists to sort the table; it is not a quality verdict.

Failure categories include parse/schema errors, deterministic validator rejection, explicit protocol limits, provider/transport failures, timeouts and output truncation.

## Seed corpus

`bench.sqlite3` is preloaded from `ai-rpg-emergency-dump-20260821-161147Z.zip` using a coverage-oriented selector: min/median/max request size for each role+stage, plus every captured failure or repair case.

This gives a small corpus spanning real character decisions, memory protocols and daytime timelapse requests, including a historical output-token truncation case.

## Run locally

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
# source .venv/bin/activate
python bench.py serve
```

Open `http://127.0.0.1:8765`.

Enter an OpenRouter model ID and API key. The key is sent only with the individual benchmark request and is not written to SQLite.

## CLI

```bash
# Import another Emergency Dump; seed selector is the default
python bench.py import-dump path/to/emergency-dump.zip

# Import every exchange instead
python bench.py import-dump path/to/emergency-dump.zip --all

# Run all selected cases for a model
set OPENROUTER_API_KEY=sk-or-...
python bench.py run deepseek/deepseek-v4-flash --repetitions 3

# Utility only
python bench.py run deepseek/deepseek-v4-flash --role utility
```

Caching key includes the captured request, model, effective request settings, contract version and repetition number. Existing paid runs are reused by default. Use `--force` or the UI's **Rerun cached** switch only when you intentionally want to pay again.

## Important limitation of v0.1

The contract validators are standalone snapshots reconstructed from the captured protocol contracts in the dump. They intentionally do not judge role-play quality. As protocols evolve, bump `CONTRACT_VERSION` and update/add validator profiles; old results remain historical rather than being silently reinterpreted.

## Candidate model shortlist

`models-to-test.json` contains a deliberately small quality/price shortlist for the first comparative run. It is a **candidate queue, not a benchmark ranking**. The web UI reads the file and exposes each entry through the model picker while still accepting arbitrary OpenRouter model IDs.

The snapshot includes token prices, context size, intended role focus and a short reason for testing each model. Price metadata is informational only: provider discounts and routing change over time, and the actual cost recorded in each benchmark run is authoritative.

The initial ten candidates are:

1. DeepSeek V4 Flash 0731
2. GPT-5.6 Luna
3. MiniMax M2.5
4. Qwen3.5 Flash 02-23
5. Mistral Small 4
6. Qwen3.5 35B A3B
7. DeepSeek V4 Pro 0813
8. Gemini 3 Flash Preview
9. GLM 5.2
10. Kimi K2.5

Where OpenRouter exposes a revision-specific model ID, the shortlist prefers it over a moving `latest` alias so cached benchmark history remains interpretable.
