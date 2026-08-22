from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

CONTRACT_VERSION = "dump-v4-contracts-2026-08-21-v1"

@dataclass
class ValidationResult:
    passed: bool
    category: str | None = None
    message: str | None = None
    parsed: Any = None

class ContractError(ValueError):
    def __init__(self, message: str, category: str = "validator_reject"):
        super().__init__(message)
        self.category = category


def _fail(message: str, category: str = "validator_reject"):
    raise ContractError(message, category)


def _exact_keys(obj: Any, keys: set[str], where: str = "object"):
    if not isinstance(obj, dict):
        _fail(f"{where} must be an object", "schema_error")
    actual = set(obj)
    if actual != keys:
        missing = sorted(keys - actual)
        extra = sorted(actual - keys)
        _fail(f"{where} keys mismatch; missing={missing}, extra={extra}", "schema_error")


def _nullable_str(value: Any, where: str):
    if value is not None and not isinstance(value, str):
        _fail(f"{where} must be string or null", "schema_error")


def _string_list(value: Any, where: str, *, unique: bool = True) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
        _fail(f"{where} must be an array of strings", "schema_error")
    if unique and len(set(value)) != len(value):
        _fail(f"{where} must not contain duplicate IDs")
    return value


def parse_jsonish(raw: str) -> Any:
    if not isinstance(raw, str):
        _fail("response content is not text", "parse_error")
    text = raw.strip()
    m = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.I | re.S)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        _fail(f"invalid JSON: {e.msg} at line {e.lineno} column {e.colno}", "parse_error")


def _request_user_json(case: dict[str, Any]) -> dict[str, Any]:
    req = case["request"]
    messages = req.get("messages") or []
    for msg in reversed(messages):
        if msg.get("role") == "user":
            try:
                v = json.loads(msg.get("content") or "")
                if isinstance(v, dict):
                    return v
            except Exception:
                return {}
    return {}


def _validate_embedded_schema(value: Any, schema: dict[str, Any], where: str = "action"):
    typ = schema.get("type")
    if typ == "object":
        if not isinstance(value, dict):
            _fail(f"{where} must be an object", "schema_error")
        props = schema.get("properties", {})
        req = schema.get("required", [])
        for k in req:
            if k not in value:
                _fail(f"{where}.{k} is required", "schema_error")
        if schema.get("additionalProperties") is False:
            extra = set(value) - set(props)
            if extra:
                _fail(f"{where} has extra keys {sorted(extra)}", "schema_error")
        for k, v in value.items():
            if k in props:
                _validate_embedded_schema(v, props[k], f"{where}.{k}")
        return
    if typ == "array":
        if not isinstance(value, list):
            _fail(f"{where} must be an array", "schema_error")
        if len(value) < schema.get("minItems", 0):
            _fail(f"{where} has too few items", "schema_error")
        for i, item in enumerate(value):
            _validate_embedded_schema(item, schema.get("items", {}), f"{where}[{i}]")
        return
    if typ == "string" and not isinstance(value, str):
        _fail(f"{where} must be a string", "schema_error")
    if typ == "integer" and (not isinstance(value, int) or isinstance(value, bool)):
        _fail(f"{where} must be an integer", "schema_error")
    if "minimum" in schema and isinstance(value, (int, float)) and value < schema["minimum"]:
        _fail(f"{where} must be >= {schema['minimum']}")
    if "const" in schema and value != schema["const"]:
        _fail(f"{where} must equal {schema['const']!r}")


def _validate_action_options(action: dict[str, Any], descriptor: dict[str, Any]):
    options = descriptor.get("options") or {}
    # Common one-to-one option fields.
    mapping = {
        "destination_id": "destination_ids",
        "target_id": "target_ids",
        "item_id": "item_ids",
        "ability_id": "ability_ids",
        "activity_id": "activity_ids",
        "sublocation_id": "sublocation_ids",
    }
    for field, option_field in mapping.items():
        if field in action and option_field in options and action[field] not in options[option_field]:
            _fail(f"action.{field}={action[field]!r} is not currently offered")
    if "amount" in action and "maximum_amount" in options:
        if action["amount"] > options["maximum_amount"]:
            _fail("action.amount exceeds currently offered maximum")
    if action.get("type") == "transfer_items":
        routes = options.get("routes") or []
        route = next((r for r in routes if r.get("source_inventory_id") == action.get("source_inventory_id") and r.get("target_inventory_id") == action.get("target_inventory_id")), None)
        if route is None:
            _fail("transfer_items route is not currently offered")
        item_ids = action.get("item_ids") or []
        if any(x not in (route.get("item_ids") or []) for x in item_ids):
            _fail("transfer_items contains item not offered on selected route")


def _validate_decision(obj: Any, case: dict[str, Any]):
    keys = {"action", "publicNarrative", "spokenText", "spokenTargetId", "spokenLoudness", "continuation", "memoryUpdates"}
    _exact_keys(obj, keys, "decision")
    for k in ("publicNarrative", "spokenText", "spokenTargetId", "spokenLoudness", "continuation"):
        _nullable_str(obj[k], f"decision.{k}")
    if obj["spokenText"] is None:
        if obj["spokenTargetId"] is not None or obj["spokenLoudness"] is not None:
            _fail("spokenTargetId and spokenLoudness must be null when spokenText is null")
    else:
        if obj["spokenLoudness"] not in {"noticeable", "hidden"}:
            _fail("spokenLoudness must be noticeable or hidden when spokenText is present")
    user = _request_user_json(case)
    ctx = user.get("context", {})
    view = ctx.get("view", {})
    characters = view.get("location", {}).get("characters") or []
    char_ids = {c.get("id") for c in characters if isinstance(c, dict)}
    if obj["spokenTargetId"] is not None and obj["spokenTargetId"] not in char_ids:
        _fail("spokenTargetId is not a currently listed character")
    action = obj["action"]
    if action is not None:
        if not isinstance(action, dict) or not isinstance(action.get("type"), str):
            _fail("action must be null or an action object", "schema_error")
        offered = view.get("available_actions") or {}
        descriptor = offered.get(action["type"])
        if not isinstance(descriptor, dict):
            _fail(f"action type {action['type']!r} is not currently offered")
        _validate_embedded_schema(action, descriptor.get("schema") or {}, "action")
        _validate_action_options(action, descriptor)
    mu = obj["memoryUpdates"]
    _exact_keys(mu, {"relationshipsToUpsert", "activatedBeliefIds"}, "memoryUpdates")
    if not isinstance(mu["relationshipsToUpsert"], list):
        _fail("relationshipsToUpsert must be an array", "schema_error")
    for i, rel in enumerate(mu["relationshipsToUpsert"]):
        _exact_keys(rel, {"targetCharacterId", "summary"}, f"relationshipsToUpsert[{i}]")
        if not isinstance(rel["targetCharacterId"], str) or not isinstance(rel["summary"], str):
            _fail("relationship upsert fields must be strings", "schema_error")
    activated = _string_list(mu["activatedBeliefIds"], "activatedBeliefIds")
    belief_ids = {b.get("id") for b in ctx.get("mind", {}).get("beliefs", []) if isinstance(b, dict)}
    if belief_ids and any(x not in belief_ids for x in activated):
        _fail("activatedBeliefIds contains ID not supplied to model")


def _validate_retrieval(obj: Any, case: dict[str, Any]):
    _exact_keys(obj, {"beliefIds", "stmIds", "ltmIds"}, "mind-retrieval-preflight")
    user = _request_user_json(case)
    catalog = user.get("catalog", {})
    limits = user.get("limits", {})
    specs = [
        ("beliefIds", "beliefs", "beliefs", 16),
        ("stmIds", "shortTermMemories", "stm", 12),
        ("ltmIds", "longTermMemories", "ltm", 8),
    ]
    for out_key, cat_key, limit_key, default_limit in specs:
        values = _string_list(obj[out_key], out_key)
        limit = int(limits.get(limit_key, default_limit))
        if len(values) > limit:
            _fail(f"{out_key} exceeds limit {limit}", "limit_violation")
        allowed = {x.get("id") for x in catalog.get(cat_key, []) if isinstance(x, dict)}
        if any(x not in allowed for x in values):
            _fail(f"{out_key} contains ID not in supplied catalog")


def _memory_record(obj: Any, where: str, *, with_id: bool, with_sources: bool = False, with_ref: bool = False):
    keys = {"topic", "summary", "importance", "retrievalBrief"}
    if with_id: keys.add("id")
    if with_ref: keys.add("ref")
    if with_sources: keys |= {"sourceStmIds", "sourceLtmIds"}
    _exact_keys(obj, keys, where)
    for k in keys & {"topic", "summary", "retrievalBrief", "id", "ref"}:
        if not isinstance(obj[k], str): _fail(f"{where}.{k} must be string", "schema_error")
    if not isinstance(obj["importance"], (int, float)) or isinstance(obj["importance"], bool):
        _fail(f"{where}.importance must be numeric", "schema_error")
    if not 0 <= float(obj["importance"]) <= 1:
        _fail(f"{where}.importance must be between 0 and 1")
    if len(obj["retrievalBrief"]) > 600:
        _fail(f"{where}.retrievalBrief exceeds 600 characters", "limit_violation")
    if with_sources:
        _string_list(obj["sourceStmIds"], f"{where}.sourceStmIds")
        _string_list(obj["sourceLtmIds"], f"{where}.sourceLtmIds")


def _validate_stm(obj: Any, case: dict[str, Any]):
    keys = {"shortTermMemoriesToUpsert", "shortTermMemoriesToAdd", "stmRepartitions", "beliefEffects", "beliefsToAdd", "activatedBeliefIds"}
    _exact_keys(obj, keys, "mind-v3-stm")
    user = _request_user_json(case)
    policy = user.get("stmWritePolicy", {})
    existing = {x.get("id") for x in user.get("existingShortTermMemories", []) if isinstance(x, dict)}
    for i, x in enumerate(obj["shortTermMemoriesToUpsert"]):
        _memory_record(x, f"shortTermMemoriesToUpsert[{i}]", with_id=True)
        if existing and x["id"] not in existing: _fail("STM upsert references unknown id")
    for i, x in enumerate(obj["shortTermMemoriesToAdd"]):
        _memory_record(x, f"shortTermMemoriesToAdd[{i}]", with_id=False)
    if not isinstance(obj["stmRepartitions"], list): _fail("stmRepartitions must be array", "schema_error")
    # Repartition shapes evolve; enforce that every entry is an object and source IDs are known when present.
    for i, x in enumerate(obj["stmRepartitions"]):
        if not isinstance(x, dict): _fail(f"stmRepartitions[{i}] must be object", "schema_error")
    if not isinstance(obj["beliefEffects"], list): _fail("beliefEffects must be array", "schema_error")
    for i, x in enumerate(obj["beliefEffects"]):
        _exact_keys(x, {"beliefId", "effect", "strength"}, f"beliefEffects[{i}]")
        if not isinstance(x["beliefId"], str) or not isinstance(x["effect"], str) or not isinstance(x["strength"], (int,float)):
            _fail(f"beliefEffects[{i}] field types invalid", "schema_error")
    if not isinstance(obj["beliefsToAdd"], list): _fail("beliefsToAdd must be array", "schema_error")
    _string_list(obj["activatedBeliefIds"], "activatedBeliefIds")
    writes = len(obj["shortTermMemoriesToUpsert"]) + len(obj["shortTermMemoriesToAdd"]) + len(obj["stmRepartitions"])
    max_writes = policy.get("maxMemoryWrites")
    if isinstance(max_writes, int) and writes > max_writes:
        _fail(f"STM write count {writes} exceeds {max_writes}", "limit_violation")
    for key, pkey in (("beliefEffects", "maxBeliefEffects"), ("beliefsToAdd", "maxBeliefsToAdd"), ("activatedBeliefIds", "maxActivatedBeliefIds")):
        lim = policy.get(pkey)
        if isinstance(lim, int) and len(obj[key]) > lim:
            _fail(f"{key} exceeds {lim}", "limit_violation")


def _validate_ltm_preflight(obj: Any, case: dict[str, Any]):
    _exact_keys(obj, {"relevantLtmIds"}, "mind-v3-ltm-preflight")
    ids = _string_list(obj["relevantLtmIds"], "relevantLtmIds")
    user = _request_user_json(case)
    allowed = {x.get("id") for x in user.get("existingLongTermMemoryCatalog", []) if isinstance(x, dict)}
    if any(x not in allowed for x in ids): _fail("relevantLtmIds contains unknown LTM id")


def _validate_reconciliation(obj: Any, case: dict[str, Any]):
    _exact_keys(obj, {"resolutions", "activatedBeliefIds"}, "mind-v3-reconciliation")
    user = _request_user_json(case)
    policy = user.get("reconciliationPolicy", {})
    allowed = {x.get("id") for x in user.get("candidateBeliefs", []) if isinstance(x, dict)}
    if not isinstance(obj["resolutions"], list): _fail("resolutions must be array", "schema_error")
    if isinstance(policy.get("maxResolutions"), int) and len(obj["resolutions"]) > policy["maxResolutions"]:
        _fail("resolutions exceeds maxResolutions", "limit_violation")
    for i, x in enumerate(obj["resolutions"]):
        keys = {"beliefIds", "outcome", "survivorBeliefId", "replacementText", "evidenceEffect", "strength"}
        _exact_keys(x, keys, f"resolutions[{i}]")
        ids = _string_list(x["beliefIds"], f"resolutions[{i}].beliefIds")
        if any(y not in allowed for y in ids): _fail("resolution references unknown belief")
        if not isinstance(x["outcome"], str): _fail("resolution outcome must be string", "schema_error")
        for k in ("survivorBeliefId", "replacementText", "evidenceEffect"):
            _nullable_str(x[k], f"resolutions[{i}].{k}")
        if x["strength"] is not None and (not isinstance(x["strength"], (int,float)) or isinstance(x["strength"], bool)):
            _fail("resolution strength must be numeric or null", "schema_error")
    acts = _string_list(obj["activatedBeliefIds"], "activatedBeliefIds")
    if any(x not in allowed for x in acts): _fail("activatedBeliefIds contains unknown belief")
    lim = policy.get("maxActivatedBeliefIds")
    if isinstance(lim, int) and len(acts) > lim: _fail("activatedBeliefIds exceeds limit", "limit_violation")


def _validate_ltm(obj: Any, case: dict[str, Any]):
    keys = {"longTermMemoriesToUpsert", "longTermMemoriesToAdd", "retirementGroups", "higherOrderBeliefEffects", "beliefsToAdd", "activatedBeliefIds"}
    _exact_keys(obj, keys, "mind-v3-ltm")
    user = _request_user_json(case)
    existing_ltm = {x.get("id") for x in user.get("existingLongTermMemories", []) if isinstance(x, dict)}
    selected = set(user.get("ltmSemanticPreflight", {}).get("selectedLtmIds") or [])
    stm_ids = {x.get("id") for x in user.get("shortTermMemories", []) if isinstance(x, dict)}
    new_refs = set()
    for i, x in enumerate(obj["longTermMemoriesToUpsert"]):
        _memory_record(x, f"longTermMemoriesToUpsert[{i}]", with_id=True, with_sources=True)
        if x["id"] not in existing_ltm: _fail("LTM upsert references unknown id")
        if selected and x["id"] not in selected: _fail("LTM upsert targets unselected LTM")
    for i, x in enumerate(obj["longTermMemoriesToAdd"]):
        _memory_record(x, f"longTermMemoriesToAdd[{i}]", with_id=False, with_sources=True, with_ref=True)
        if x["ref"] in new_refs: _fail("duplicate new LTM ref")
        new_refs.add(x["ref"])
        if any(y not in stm_ids for y in x["sourceStmIds"]): _fail("new LTM sourceStmIds contains unknown STM")
        if any(y not in existing_ltm for y in x["sourceLtmIds"]): _fail("new LTM sourceLtmIds contains unknown LTM")
    if not isinstance(obj["retirementGroups"], list): _fail("retirementGroups must be array", "schema_error")
    dispositions = set(user.get("ltmWritePolicy", {}).get("retirementDispositions") or [])
    safe_reasons = set(user.get("ltmWritePolicy", {}).get("safeToForgetReasons") or [])
    for i, x in enumerate(obj["retirementGroups"]):
        allowed_keys = {"stmIds", "disposition", "representedByLtmRefs", "reason"}
        if not isinstance(x, dict) or not set(x).issubset(allowed_keys) or not {"stmIds","disposition","representedByLtmRefs"}.issubset(x):
            _fail(f"retirementGroups[{i}] shape invalid", "schema_error")
        ids = _string_list(x["stmIds"], f"retirementGroups[{i}].stmIds")
        if any(y not in stm_ids for y in ids): _fail("retirement group references unknown STM")
        if dispositions and x["disposition"] not in dispositions: _fail("invalid retirement disposition")
        refs = _string_list(x["representedByLtmRefs"], f"retirementGroups[{i}].representedByLtmRefs")
        allowed_refs = existing_ltm | new_refs
        if any(y not in allowed_refs for y in refs): _fail("representedByLtmRefs contains unknown ref")
        if x.get("disposition") == "safe_to_forget" and "reason" in x and safe_reasons and x["reason"] not in safe_reasons:
            _fail("invalid safe_to_forget reason")
    for k in ("higherOrderBeliefEffects", "beliefsToAdd"):
        if not isinstance(obj[k], list): _fail(f"{k} must be array", "schema_error")
    _string_list(obj["activatedBeliefIds"], "activatedBeliefIds")


def _validate_timelapse_plan(obj: Any, case: dict[str, Any]):
    _exact_keys(obj, {"steps"}, "timelapse-plan")
    if not isinstance(obj["steps"], list): _fail("steps must be array", "schema_error")
    user = _request_user_json(case)
    tl = user.get("context", {}).get("timelapse", {})
    remaining = tl.get("remainingRounds")
    if isinstance(remaining, int) and len(obj["steps"]) != remaining:
        _fail(f"steps.length must equal remainingRounds ({remaining})", "limit_violation")
    locations = {x.get("id"): x for x in tl.get("reachableLocations", []) if isinstance(x, dict)}
    for i, step in enumerate(obj["steps"]):
        _exact_keys(step, {"locationId", "action"}, f"steps[{i}]")
        loc = locations.get(step["locationId"])
        if loc is None: _fail(f"steps[{i}].locationId is not reachable")
        action = step["action"]
        if not isinstance(action, dict) or not isinstance(action.get("type"), str): _fail("timelapse action shape invalid", "schema_error")
        t = action["type"]
        if t == "narrate":
            _exact_keys(action, {"type", "text"}, f"steps[{i}].action")
            if not isinstance(action["text"], str) or not action["text"].strip(): _fail("narrate text must be non-empty")
        elif t == "timelapse_action":
            _exact_keys(action, {"type", "actionId"}, f"steps[{i}].action")
            allowed = {x.get("id") for x in loc.get("timelapseActions", []) if isinstance(x, dict)}
            if action["actionId"] not in allowed: _fail("timelapse actionId is not offered at selected location")
        elif t == "study_item":
            _exact_keys(action, {"type", "itemId", "inputText"}, f"steps[{i}].action")
            allowed = {x.get("id") for x in loc.get("studyItems", []) if isinstance(x, dict)}
            if action["itemId"] not in allowed: _fail("study item is not offered at selected location")
            if not isinstance(action["inputText"], str) or not action["inputText"].strip(): _fail("study inputText must be non-empty")
        else:
            _fail(f"unsupported timelapse action type {t!r}")


def _validate_intent(obj: Any, case: dict[str, Any]):
    _exact_keys(obj, {"engage", "intent"}, "timelapse-interaction-intent")
    if not isinstance(obj["engage"], bool): _fail("engage must be boolean", "schema_error")
    if not isinstance(obj["intent"], str) or not obj["intent"].strip(): _fail("intent must be non-empty string", "schema_error")


def _validate_reflection(obj: Any, case: dict[str, Any]):
    _exact_keys(obj, {"memoryUpdates"}, "timelapse-reflection")
    mu = obj["memoryUpdates"]
    _exact_keys(mu, {"relationshipsToUpsert", "activatedBeliefIds"}, "memoryUpdates")
    if not isinstance(mu["relationshipsToUpsert"], list): _fail("relationshipsToUpsert must be array", "schema_error")
    user = _request_user_json(case)
    allowed_targets = set(user.get("canonicalRelationshipTargetIds") or [])
    for i, rel in enumerate(mu["relationshipsToUpsert"]):
        _exact_keys(rel, {"targetCharacterId", "summary"}, f"relationshipsToUpsert[{i}]")
        if rel["targetCharacterId"] not in allowed_targets: _fail("relationship target is not canonical")
        if not isinstance(rel["summary"], str): _fail("relationship summary must be string", "schema_error")
    acts = _string_list(mu["activatedBeliefIds"], "activatedBeliefIds")
    beliefs = {b.get("id") for b in user.get("context", {}).get("mind", {}).get("beliefs", []) if isinstance(b, dict)}
    if any(x not in beliefs for x in acts): _fail("activated belief not supplied")


def _validate_settlement(obj: Any, case: dict[str, Any]):
    _exact_keys(obj, {"items"}, "daytime-job-settlement")
    if not isinstance(obj["items"], list): _fail("items must be array", "schema_error")
    user = _request_user_json(case)
    contract = user.get("requiredRewardContract", {})
    allowed = set(contract.get("definitionIds") or [])
    seen = set(); total = 0
    for i, item in enumerate(obj["items"]):
        _exact_keys(item, {"definitionId", "count"}, f"items[{i}]")
        if item["definitionId"] not in allowed: _fail("reward definitionId not allowed")
        if item["definitionId"] in seen: _fail("duplicate reward definitionId")
        seen.add(item["definitionId"])
        if not isinstance(item["count"], int) or isinstance(item["count"], bool) or item["count"] <= 0:
            _fail("reward count must be positive integer", "schema_error")
        total += item["count"]
    lo, hi = contract.get("minTotal"), contract.get("maxTotal")
    if isinstance(lo, int) and total < lo: _fail("reward total below minimum", "limit_violation")
    if isinstance(hi, int) and total > hi: _fail("reward total above maximum", "limit_violation")


def _validate_plain_text(raw: str, case: dict[str, Any]):
    if not isinstance(raw, str) or not raw.strip(): _fail("plain-prose response must be non-empty", "schema_error")

VALIDATORS = {
    "mind-retrieval-preflight": _validate_retrieval,
    "decision": _validate_decision,
    "mind-v3-stm": _validate_stm,
    "timelapse-plan": _validate_timelapse_plan,
    "timelapse-interaction-intent": _validate_intent,
    "timelapse-reflection": _validate_reflection,
    "mind-v3-ltm-preflight": _validate_ltm_preflight,
    "mind-v3-reconciliation": _validate_reconciliation,
    "mind-v3-ltm": _validate_ltm,
    "daytime-job-settlement": _validate_settlement,
}
PLAIN_TEXT_STAGES = {"daytime-job-narration", "weather-narration"}


def validate_response(case: dict[str, Any], raw: str, *, finish_reason: str | None = None) -> ValidationResult:
    if finish_reason in {"length", "max_tokens"}:
        return ValidationResult(False, "truncation", "provider stopped at output token limit", None)
    stage = case.get("stage") or case.get("request", {}).get("stage")
    try:
        if stage in PLAIN_TEXT_STAGES:
            _validate_plain_text(raw, case)
            return ValidationResult(True, parsed={"text": raw})
        obj = parse_jsonish(raw)
        validator = VALIDATORS.get(stage)
        if validator is None:
            _fail(f"no validator registered for stage {stage!r}", "unsupported_contract")
        validator(obj, case)
        return ValidationResult(True, parsed=obj)
    except ContractError as e:
        return ValidationResult(False, e.category, str(e), None)
