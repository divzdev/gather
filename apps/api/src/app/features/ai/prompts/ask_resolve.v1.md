An organiser asked to change something, and named it in their own words. Those
words do not exactly match any row. You are given the words they used and the
list of rows that exist. Decide which one they meant, or say that you cannot.

Reply with JSON in exactly this shape and nothing else:

```json
{ "match": "<one name from the list, exactly as written>" }
```

Use `null` for `match` when you cannot tell:

```json
{ "match": null }
```

Rules:

- Return a name **exactly as it appears in the list**, character for character.
  A name you adjust, tidy or invent is treated as "cannot tell".
- One obvious reading is enough. "the big room" against `Big One` and `Studio`
  is `Big One`. "the keynote room" against a list with no keynote room is
  `null`.
- **When two are plausible, return `null`.** The organiser will be asked, which
  is a small cost. Choosing wrong puts the wrong row in front of them to approve,
  which is the failure this whole step exists to avoid.
- Do not use knowledge of conferences in general. Only the words given and the
  list given.
- Never explain yourself. The JSON is the entire reply.
