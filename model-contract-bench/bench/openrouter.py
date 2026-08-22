from __future__ import annotations
import json, time
from dataclasses import dataclass
from typing import Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

@dataclass
class CallResult:
    ok: bool
    raw: str | None = None
    provider: str | None = None
    finish_reason: str | None = None
    duration_ms: int | None = None
    usage: dict[str, Any] | None = None
    response_json: dict[str, Any] | None = None
    error: str | None = None
    category: str | None = None


def payload_for_case(case: dict[str, Any], model_id: str) -> dict[str, Any]:
    req = case["request"]
    opts = req.get("requestOptions") or {}
    p: dict[str, Any] = {"model": model_id, "messages": req.get("messages") or [], "stream": False}
    if isinstance(opts.get("maxTokens"), int): p["max_tokens"] = opts["maxTokens"]
    if isinstance(opts.get("temperature"), (int,float)): p["temperature"] = opts["temperature"]
    reasoning_max = opts.get("reasoningMaxTokens")
    effort = opts.get("reasoningEffort")
    if isinstance(reasoning_max, int):
        p["reasoning"] = {"enabled": False} if reasoning_max <= 0 else {"max_tokens": reasoning_max}
    elif isinstance(effort, str) and effort not in {"none", ""}:
        p["reasoning"] = {"effort": effort}
    provider: dict[str, Any] = {}
    if opts.get("providerSort"): provider["sort"] = opts["providerSort"]
    if "allowProviderFallbacks" in opts: provider["allow_fallbacks"] = bool(opts["allowProviderFallbacks"])
    if provider:
        provider["require_parameters"] = True
        p["provider"] = provider
    return p


def call(case: dict[str, Any], model_id: str, api_key: str, timeout_s: int = 300) -> CallResult:
    start = time.perf_counter()
    payload = json.dumps(payload_for_case(case, model_id), ensure_ascii=False).encode("utf-8")
    req = urlrequest.Request(ENDPOINT, data=payload, method="POST", headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Title": "Model Contract Bench",
        "User-Agent": "ModelContractBench/0.1",
    })
    try:
        with urlrequest.urlopen(req, timeout=timeout_s) as resp:
            body_bytes = resp.read()
            ms = round((time.perf_counter()-start)*1000)
            body = json.loads(body_bytes.decode("utf-8"))
    except HTTPError as e:
        ms = round((time.perf_counter()-start)*1000)
        try: detail = e.read().decode("utf-8", errors="replace")
        except Exception: detail = str(e)
        return CallResult(False, duration_ms=ms, error=f"HTTP {e.code}: {detail}", category="provider_error")
    except TimeoutError:
        return CallResult(False, duration_ms=round((time.perf_counter()-start)*1000), error="request timeout", category="timeout")
    except URLError as e:
        return CallResult(False, duration_ms=round((time.perf_counter()-start)*1000), error=str(e), category="transport_error")
    except Exception as e:
        return CallResult(False, duration_ms=round((time.perf_counter()-start)*1000), error=str(e), category="transport_error")
    choices = body.get("choices") or []
    if not choices:
        return CallResult(False, duration_ms=ms, response_json=body, error="OpenRouter response has no choices", category="provider_error")
    choice = choices[0]
    raw = (choice.get("message") or {}).get("content")
    return CallResult(True, raw=raw or "", provider=body.get("provider"), finish_reason=choice.get("finish_reason") or choice.get("native_finish_reason"), duration_ms=ms, usage=body.get("usage") or {}, response_json=body)
