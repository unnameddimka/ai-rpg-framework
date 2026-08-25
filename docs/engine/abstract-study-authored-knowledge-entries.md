# Abstract Study — Authored Keyword Knowledge Entries

**Status:** Implemented
**Scope:** generic deterministic authored reference entries layered onto `abstract_study`

## Purpose

Allow an authored `abstract_study` item to act as a small deterministic encyclopedia for selected canonical subjects without introducing a Utility-model lore generation path or a second study action.

The existing abstract-study behavior remains the fallback for all unmatched questions.

## Authoring

An `abstract_study` `useAction` may optionally define:

```json
{
  "knowledgeEntries": [
    {
      "id": "subject_id",
      "title": "Optional article title",
      "priority": 0,
      "keywords": ["exact phrase", "prefix*", "alias"],
      "article": "Canonical private reference text."
    }
  ]
}
```

`knowledgeEntries` belongs to the item action authoring. It is not runtime character state and is not inferred from model prose or memories.

Each entry supports multiple keyword aliases. A single trailing `*` means prefix matching on the final token, so `otherworld*` matches `otherworld`, `otherworldly`, etc. Wildcards elsewhere are invalid.

Matching is case-insensitive, Unicode-aware for the currently supported Latin/Cyrillic ranges, punctuation-insensitive, and token/phrase based rather than raw substring matching.

If more than one entry matches, higher `priority` wins; equal priorities prefer the more specific matched keyword; a final tie uses authored order.

## Execution

When `abstract_study` receives `input_text`:

1. deterministically search authored `knowledgeEntries`;
2. if an entry matches, return its authored `article` as private reader feedback;
3. do not invoke Utility or any other model;
4. do not advance/reset ordinary `abstractStudyProgressByCharacterId` for the indexed article request;
5. if no entry matches, execute the existing `survey -> focused -> saturated` behavior unchanged.

Matched entries always return their canonical article, including on repeated reads. They do not degrade into saturated generic feedback.

## Privacy and timelapse

Ordinary `use_item` returns the article only to the acting reader through private item feedback.

Timelapse `study_item` uses the same matcher. The public/room activity remains a generic statement that the actor consulted the item. If a canonical article matched, its text is committed only to that reader's timelapse experience so the reader can remember/reason from it without broadcasting the article to everyone present.

## Validation

Authored and runtime world validation reject malformed encyclopedia authoring, including:

- non-array or oversized `knowledgeEntries`;
- missing/duplicate entry IDs;
- empty/oversized article text;
- missing/empty/duplicate keyword lists;
- malformed wildcard placement;
- unusable keyword stems;
- invalid priority values.

No arbitrary authored code is executable.

## Compatibility

- Existing `abstract_study` items without `knowledgeEntries` behave exactly as before.
- Existing item-owned per-reader study progress remains save-compatible.
- No save migration is required because encyclopedia entries are authored definition data, not runtime state.
- `utility_query` remains a separate effect and is not used for these canonical articles.
