# Lemonator Integration Guide

> How to wire the enriched `character-knowledge.json` (v1.1.0) into Lemonator
> to make use of the new fields. Ordered by impact and ease of implementation.

---

## Step 0: Copy the Updated Database

The rag repo's database is v1.1.0. Lemonator is still running v1.0.0.

```bash
cp data/character-knowledge.json ../Lemonator/public/character-knowledge.json
```

This is the only step that requires no code changes and immediately gives Lemonator
the corrected `fictional` flags, removed disambiguation artifacts, and the 31
previously-missing characters that are now fully enriched.

---

## 1. Use `traits.alive` Directly (Quick Win)

**Files:** `character-rag.ts` → `characterMatchesTrait()`

**Current behaviour:** The code infers alive/dead from `distinctive_facts[0]` using
a regex that looks for a `YYYY–YYYY` year-range pattern. This misses many cases and
produces wrong results for characters whose first fact doesn't contain dates.

**New behaviour:** Read `traits.alive` directly.

```ts
// In characterMatchesTrait(), replace the is_alive inference block with:
case 'is_alive':
  if (char.traits.alive !== null && char.traits.alive !== undefined) {
    return value ? char.traits.alive === true : char.traits.alive === false;
  }
  // Fallback: legacy text inference for chars without the field
  const factsText = char.distinctive_facts.join(' ');
  return value
    ? !/\d{4}[–\-]\d{4}/.test(factsText)
    : /\d{4}[–\-]\d{4}/.test(factsText);
```

**Impact:** The question "Is this person still alive?" becomes a reliable binary
splitter (186 living / 129 deceased) instead of an unreliable heuristic.

---

## 2. Use `traits.media_origin` for Fictional Character Splitting (Quick Win)

**Files:** `character-rag.ts` → `characterMatchesTrait()`, `detective-rag.ts` → trait extractor

**Current behaviour:** The trait extractor infers `origin_medium` (manga/anime,
american_comic, live_action_tv, animated_tv) from Q&A answers, but the character
filter has no reliable field to match against — it falls back to searching
`distinctive_facts` text.

**New behaviour:** `traits.media_origin` now stores exactly these values for all
190 fictional characters. Map the extractor's `origin_medium` trait directly to
this field in filtering.

```ts
// In characterMatchesTrait(), add a case:
case 'origin_medium':
  if (char.traits.media_origin) {
    return char.traits.media_origin === value;
  }
  // Fallback for chars without the field
  return char.distinctive_facts.join(' ').toLowerCase().includes(value);
```

**Values:** `"manga/anime"` (63 chars), `"american_comic"` (62), `"live_action_tv"` (44),
`"animated_tv"` (21).

**Impact:** "Is your character from an anime?" goes from a fuzzy text search to a
hard filter, immediately cutting 190 fictional candidates by ~67%.

---

## 3. Use `traits.birth_decade` for Era Questions (Quick Win)

**Files:** `character-rag.ts` → `characterMatchesTrait()` and `getMostInformativeQuestion()`

**Current behaviour:** No era-based filtering exists for real people. The question
"Was this person active before 1980?" can be asked but can't be matched against any
character field.

**New behaviour:** Add `birth_decade` matching and add era questions to the
strategic question pool.

```ts
// In characterMatchesTrait():
case 'born_before_1980':
  return char.traits.birth_decade != null
    ? (value ? char.traits.birth_decade < 1980 : char.traits.birth_decade >= 1980)
    : null; // unknown — don't filter this character out

case 'born_before_1960':
  return char.traits.birth_decade != null
    ? (value ? char.traits.birth_decade < 1960 : char.traits.birth_decade >= 1960)
    : null;
```

Add to the strategic question pool in `getMostInformativeQuestion()`:
```ts
{ question: "Was this person born before 1980?", trait: "born_before_1980" },
{ question: "Was this person born before 1960?", trait: "born_before_1960" },
```

**Coverage:** 301/506 characters have `birth_decade`. Null-safe — characters without
it are not filtered out, just not positively matched.

**Impact:** Efficiently splits the ~315 real people by era. "Born before 1980?"
splits historical figures and older celebrities from younger ones.

---

## 4. Use `sitelink_count` as a Prominence Signal (Medium)

**Files:** `character-rag.ts` → `scoreCharacterMatch()`

**Current behaviour:** The `scoreCharacterMatch()` function has a small
`prominenceBonus` but it's computed from the length of `distinctive_facts` and
`signature_works` arrays — a very weak proxy.

**New behaviour:** Use `sitelink_count` as the authoritative popularity signal.

```ts
// In scoreCharacterMatch(), replace the prominenceBonus calculation:
const sitelinkCount = char.sitelink_count ?? 0;
const prominenceBonus = Math.min(0.15, sitelinkCount / 2000);
// Result: Einstein(319 links) → +0.15, a minor anime char(20 links) → +0.01
```

**Use in early guessing:** When only 2-3 candidates remain and they're close in
score, the one with the highest `sitelink_count` is more likely to be the answer
(more famous = more often guessed).

**Use in `getCandidateContext()`:** Include sitelink_count in the LLM prompt so it
can calibrate its confidence:
```ts
// Append to each candidate line:
`${char.name} (${char.category}, ${char.sitelink_count ?? '?'} wiki links)`
```

**Impact:** The AI learns to guess Jesus (341 links) before a minor biblical figure
(12 links) when both match the same traits.

---

## 5. Surface `signature_works` to the AI (High Impact, Medium Effort)

**Files:** `character-rag.ts` → `getCandidateContext()`, `detective-rag.ts` → `lookup_character` tool

**Current behaviour:** `signature_works` is fully populated in the database (Tom
Hanks has 10 films, Adele has 0, Goku has 4 Dragon Ball entries) but **zero lines
of code in Lemonator ever read it**. The LLM never sees it.

### 5a. Add to `getCandidateContext()`

```ts
// Currently returns: "1. Tom Hanks (actors): American actor..., Born 1956"
// Change to also include top works:
function getCandidateContext(candidates: CharacterData[]): string {
  return candidates.slice(0, 5).map((char, i) => {
    const facts = char.distinctive_facts.slice(0, 2).join('; ');
    const works = char.signature_works
      .slice(0, 3)
      .map(w => w.name)
      .join(', ');
    return `${i + 1}. ${char.name} (${char.category}): ${facts}${works ? ` | Works: ${works}` : ''}`;
  }).join('\n');
}
```

### 5b. Add to `lookup_character` tool response

```ts
// In the lookup_character tool handler, add:
signature_works: char.signature_works.slice(0, 5).map(w => ({
  name: w.name,
  type: w.type,
  year: w.year,
})),
```

### 5c. Add `signature_works` filtering to `characterMatchesTrait()`

For questions like "Has your character appeared in a war film?" or
"Does your character have an Oscar-winning film?":

```ts
case 'has_signature_work':
  // value is a work name or partial name
  return char.signature_works.some(w =>
    w.name.toLowerCase().includes(value.toLowerCase())
  );
```

**Impact:** This is the highest-value single change. The LLM currently has no idea
that Tom Hanks was in Forrest Gump or that Adele won an Oscar for Skyfall. Including
works in the candidate context and tool responses will dramatically improve
late-game discrimination.

---

## 6. Use `traits.gender` Directly (Small Fix)

**Files:** `character-rag.ts` → `characterMatchesTrait()`

**Current behaviour:** Gender is inferred by scanning `distinctive_facts` for
"actor"/"actress", "he "/"she ", "his "/"her ". Characters with no gendered
language in their facts get `undefined` on gender — they are not filtered out by
gender questions, meaning a gender:male answer doesn't eliminate female characters
whose facts happen to be gender-neutral.

**New behaviour:** `traits.gender` is populated from Wikidata for 490+ characters.

```ts
case 'gender':
  if (char.traits.gender) {
    const isMale = char.traits.gender === 'male';
    return value === 'male' ? isMale : !isMale;
  }
  // Fallback: text inference for chars without the field
  ...existing heuristic...
```

**Impact:** Gender becomes a reliable hard filter from turn 1 or 2, cutting the
search space in half immediately.

---

## 7. Use `aliases` for Answer Matching (Small Fix)

**Files:** `useGameLoop.ts` or wherever the guess confirmation is handled

**Current behaviour:** If a user is thinking of "Bruce Wayne" (Batman's real name),
the character cannot be found by that name. The game must guess "Batman" and the
user must recognize it.

**New behaviour:** When the game makes a guess or searches for a character, also
check `aliases`.

```ts
// When checking if a character name matches user's character:
function characterMatchesName(char: CharacterData, name: string): boolean {
  const lower = name.toLowerCase();
  return char.name.toLowerCase() === lower ||
    (char.aliases ?? []).some(a => a.toLowerCase() === lower);
}
```

**Impact:** Small but polished — prevents confusion when the user types an alias or
alternate name.

---

## 8. Align `origin_medium` Trait Key with `media_origin` Field (Cleanup)

**Files:** `detective-rag.ts` → `TRAIT_EXTRACTOR_PROMPT`, `character-rag.ts` → filtering

**Issue:** The trait extractor uses the key `origin_medium` in extracted traits, but
the character database field is `traits.media_origin`. These need to be consistently
named everywhere — either rename the extractor output to `media_origin`, or add an
alias in the filtering code.

**Recommended:** Rename the extractor output to `media_origin` so it matches the DB
field directly.

---

## Summary: Recommended Implementation Order

| # | Change | Files | Effort | Impact |
|---|--------|-------|--------|--------|
| 0 | Copy updated database | shell | 1 min | Immediately fixes 62 chars |
| 1 | Use `traits.alive` directly | character-rag.ts | 15 min | Reliable alive/dead filter |
| 2 | Use `traits.gender` directly | character-rag.ts | 15 min | Reliable gender filter from turn 1 |
| 3 | Use `traits.media_origin` | character-rag.ts | 20 min | Hard filter for fictional char origin |
| 4 | Align `origin_medium` key | detective-rag.ts | 10 min | Cleanup prerequisite for #3 |
| 5 | `signature_works` in context | character-rag.ts, detective-rag.ts | 45 min | Biggest AI quality gain |
| 6 | `sitelink_count` prominence | character-rag.ts | 20 min | Better early guess calibration |
| 7 | `birth_decade` era questions | character-rag.ts | 30 min | New question dimension for real people |
| 8 | `aliases` matching | useGameLoop.ts | 15 min | Small UX polish |
| 9 | `relationships` cross-refs | character-rag.ts, detective-rag.ts | 30 min | In-DB pair linking (Jay-Z↔Beyoncé) |
| 10 | `traits.manner_of_death` | character-rag.ts | 20 min | Assassination/natural split for historicals |
| 11 | `traits.primary_genre` + `genre_tags` | character-rag.ts | 30 min | Genre split for actors & musicians |
| 12 | Fandom fields (powers/species/affiliation/appearance) | character-rag.ts, detective-rag.ts | 45 min | Structured fictional char discrimination |

**Prerequisite before steps 10–12:** run `add_death_info.py`, `add_genre_tags.py`, `add_fandom_data.py` to populate the data.

Steps 0–4 together take under an hour and unlock most of the value from the
enriched database. Step 5 (`signature_works`) is the biggest quality improvement
but requires careful prompt engineering to avoid overwhelming the LLM context.

---

## Fields Not Yet Worth Wiring Up

These fields exist in the database but the data isn't complete enough to act on yet:

| Field | Coverage | Wait for... |
|-------|----------|-------------|
| `traits.birth_decade` for fictional | 1 char (Phoebe Buffay) | Most anime/superhero works don't have birth years in Wikidata |
| `traits.powers` / `traits.species` / `traits.affiliation` | ~0 until scripts run | Run `add_fandom_data.py` — then wire per section 12 below |
| `appearance.hair_color` / `.eye_color` | ~0 until scripts run | Run `add_fandom_data.py` — then wire per section 12 below |
| `traits.manner_of_death` | ~0 until scripts run | Run `add_death_info.py` — then wire per section 10 below |
| `traits.primary_genre` / `genre_tags` | ~0 until scripts run | Run `add_genre_tags.py` — then wire per section 11 below |

---

## 9. Use `relationships` for In-DB Cross-References (New — Medium Impact)

**Files:** `character-rag.ts` → `characterMatchesTrait()`, `getCandidateContext()`,
`detective-rag.ts` → `lookup_character` tool

**What's new:** Phase 2A completed. All 316 real people now have `relationships` data with
`spouse`, `children`, `parents`, `siblings` arrays (from Wikidata). A special `in_db` key
lists family members who are **also characters in the database**.

```json
"jay-z": {
  "relationships": {
    "spouse": ["Beyoncé"],
    "children": ["Blue Ivy Carter", "Rumi Carter", "Sir Carter"],
    "parents": [],
    "siblings": [],
    "in_db": ["Beyoncé"]
  }
}
```

Notable in-DB pairs: Jay-Z↔Beyoncé, Brad Pitt↔Angelina Jolie↔Jennifer Aniston,
Ryan Reynolds↔Scarlett Johansson, Serena↔Venus Williams, George H.W.↔George W. Bush,
Tom Cruise↔Nicole Kidman.

### 9a. Use in `getCandidateContext()`

When `in_db` is non-empty, include the relationship so the LLM can ask targeted questions:

```ts
const inDb = char.relationships?.in_db ?? [];
const relNote = inDb.length > 0
  ? ` | Linked to: ${inDb.join(', ')}`
  : '';
return `${i+1}. ${char.name} (${char.category}): ${facts}${relNote}`;
```

### 9b. Add `has_famous_spouse` trait question

```ts
case 'has_famous_spouse':
  const spouses = char.relationships?.spouse ?? [];
  return value
    ? spouses.length > 0
    : spouses.length === 0;

case 'has_famous_children':
  const children = char.relationships?.children ?? [];
  return value
    ? children.length > 0
    : children.length === 0;
```

Add to strategic question pool:
```ts
{ question: "Is this person married to someone famous?", trait: "has_famous_spouse" },
```

**Impact:** Enables the question "Is this person married to another famous person in our game?"
which immediately links Jay-Z↔Beyoncé and Brad Pitt↔Angelina Jolie.

---

## 10. Use `traits.manner_of_death` for Historical Figure Questions (New — Low Effort)

**Prerequisite:** Run `python3 scripts/add_death_info.py` first.

**Files:** `character-rag.ts` → `characterMatchesTrait()`, `detective-rag.ts` → trait extractor

**What's new:** `traits.manner_of_death` is populated for deceased real people. Values:
`"natural"` | `"assassination"` | `"execution"` | `"accident"` | `"combat"` | `"suicide"` | `"disease"`

```ts
// In characterMatchesTrait():
case 'manner_of_death':
  if (char.traits.manner_of_death) {
    return char.traits.manner_of_death === value;
  }
  return null; // unknown — don't filter out

case 'was_assassinated':
  if (char.traits.manner_of_death) {
    return value
      ? char.traits.manner_of_death === 'assassination'
      : char.traits.manner_of_death !== 'assassination';
  }
  return null;
```

Add to strategic question pool (only asked when candidate pool is deceased real people):
```ts
{ question: "Was this person assassinated?", trait: "was_assassinated" },
{ question: "Did this person die in battle or combat?", trait: "manner_of_death", value: "combat" },
```

**Impact:** Immediately separates Lincoln/JFK/Caesar (assassination) from Einstein/Darwin
(natural) within the historical figures pool. Also a distinctive fact already written to
`distinctive_facts` (e.g. `"Manner of death: assassination"`), so the LLM sees it in
candidate context even before this is wired.

---

## 11. Use `traits.primary_genre` and `signature_works[i].genre_tags` (New — Medium Impact)

**Prerequisite:** Run `python3 scripts/add_genre_tags.py` first.

**Files:** `character-rag.ts` → `characterMatchesTrait()`, `getCandidateContext()`

**What's new:**
- `traits.primary_genre` — most common genre across an actor's filmography, or the
  primary music genre for a musician (e.g. `"drama"`, `"action"`, `"hip-hop"`)
- `signature_works[i].genre_tags` — per-film genre list for actors (e.g. `["drama", "thriller"]`)

### 11a. Trait matching

```ts
case 'primary_genre':
  if (char.traits.primary_genre) {
    return char.traits.primary_genre === value;
  }
  return null;

case 'has_genre_work':
  // value is a genre string; true if any signature work has that genre tag
  return char.signature_works?.some(w =>
    (w.genre_tags ?? []).includes(value)
  ) ?? null;
```

Add to strategic question pool:
```ts
{ question: "Is this actor primarily known for drama films?", trait: "primary_genre", value: "drama" },
{ question: "Is this actor primarily known for action films?", trait: "primary_genre", value: "action" },
{ question: "Has this actor appeared in a sci-fi film?", trait: "has_genre_work", value: "sci-fi" },
```

### 11b. Include in candidate context

```ts
// In getCandidateContext(), append primary_genre to actor/musician lines:
const genre = char.traits.primary_genre;
const genreNote = genre ? ` | Genre: ${genre}` : '';
return `${i+1}. ${char.name} (${char.category}): ${facts}${genreNote}`;
```

**Impact:** Splits the 77 actors by primary genre (drama vs. action vs. comedy) — a high-value
dimension that currently has zero coverage. Lets the LLM ask "Is this person primarily a
drama actor?" to halve the actor pool in one question.

---

## 12. Use Fandom Fields for Fictional Character Questions (New — High Impact)

**Prerequisite:** Run `python3 scripts/add_fandom_data.py` first (~150/189 fictional chars populated).

**Files:** `character-rag.ts` → `characterMatchesTrait()`, `getCandidateContext()`,
`detective-rag.ts` → `lookup_character` tool

**What's new (per character, when found in Fandom wiki infobox):**
- `appearance.hair_color`, `appearance.eye_color` — physical appearance strings
- `traits.powers` — list of abilities (superheroes + anime)
- `traits.species` — e.g. `"Saiyan"`, `"mutant"`, `"Time Lord"`, `"human"`
- `traits.affiliation` — list of team/org names (e.g. `["Avengers", "S.H.I.E.L.D."]`)

### 12a. Trait matching

```ts
case 'species':
  if (char.traits.species) {
    return char.traits.species.toLowerCase().includes(value.toLowerCase());
  }
  return null;

case 'is_human':
  if (char.traits.species) {
    const isHuman = char.traits.species.toLowerCase() === 'human';
    return value ? isHuman : !isHuman;
  }
  return null;

case 'has_power':
  // value is a partial power name
  return (char.traits.powers ?? []).some(p =>
    p.toLowerCase().includes(value.toLowerCase())
  ) || null;

case 'affiliation':
  // value is a team/org name
  return (char.traits.affiliation ?? []).some(a =>
    a.toLowerCase().includes(value.toLowerCase())
  ) || null;

case 'hair_color':
  if (char.appearance?.hair_color) {
    return char.appearance.hair_color.toLowerCase().includes(value.toLowerCase());
  }
  return null;
```

Add to strategic question pool (for fictional character pools):
```ts
{ question: "Is this character human?", trait: "is_human" },
{ question: "Does this character have superpowers or special abilities?", trait: "has_powers" },
{ question: "Is this character affiliated with the Avengers?", trait: "affiliation", value: "avengers" },
{ question: "Is this character a Marvel character?", trait: "affiliation", value: "marvel" },
```

### 12b. Include in candidate context and lookup tool

```ts
// In getCandidateContext(), for fictional characters:
const powers = (char.traits.powers ?? []).slice(0, 2).join(', ');
const affil = (char.traits.affiliation ?? []).slice(0, 2).join(', ');
const appearance = [char.appearance?.hair_color, char.appearance?.eye_color]
  .filter(Boolean).join(' hair, ') + (char.appearance?.eye_color ? ' eyes' : '');
const extras = [powers, affil, appearance].filter(Boolean).join(' | ');
return `${i+1}. ${char.name} (${char.category}): ${facts}${extras ? ' | ' + extras : ''}`;

// In lookup_character tool response, add:
powers: char.traits.powers ?? [],
species: char.traits.species ?? null,
affiliation: char.traits.affiliation ?? [],
appearance: char.appearance ?? {},
```

**Impact:** Transforms fictional character discrimination from pure text-search guesswork
into structured binary filters. "Is this character affiliated with the Avengers?" immediately
narrows the field. Hair/eye color adds a physical dimension the LLM can ask about naturally.
