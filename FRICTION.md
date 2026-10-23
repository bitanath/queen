# Friction Log

This is a record of friction encountered while building Queen on top of Bee CLI. It is not a bug list. Each entry describes what the CLI surface exposes today, why it complicates agent-first use, how Queen works around it, and what an upstream fix could look like.

The observations below are against the pinned `bee-cli` revision in this repository (`e67032d`, `v0.8.0~7`). Upstream may have moved since.

## At a glance

| # | Friction                                                 | Why it matters                                                             | Queen's workaround                                                        | Upstream ask                                                            |
|---|----------------------------------------------------------|----------------------------------------------------------------------------|---------------------------------------------------------------------------|-------------------------------------------------------------------------|
| 1 | Semantic (`--neural`) search exposes no relevance scores | Ranking is opaque; results cannot be thresholded, compared, or explained   | Local PFA relevance scoring, with explicit scores in the payload and card | Return per-result score/distance, model version, and a documented scale |
| 2 | No diarization; speakers are blank or `Unknown`          | Who-said-what, per-speaker analytics, and quote attribution are unreliable | Text-only inferred labels, explicitly marked as a guess                   | Audio-based diarization with stable anonymous speaker IDs               |
| 3 | JSON is uneven; agents are pushed to MCP only            | Pipelines scrape text, and client-side heuristics do not compose           | One stable JSON envelope and an in-process adapter over Bee's registry    | Uniform versioned JSON and equivalent MCP tools                         |


## 1. Semantic search exposes no relevance score

**Observed.** `bee search --neural` posts `{query, limit, since?, until?}` to `/v1/search/conversations/neural` and prints the response as returned (`bee-cli/sources/resources/search/index.ts`). Keyword search can carry a BM25 `score` and supports `--sort relevance`. Neural search rejects `--filter`, `--scope`, and `--sort`, and the response contract exposes no score, distance, model name, index version, or threshold.

**Impact.** The ordering is meaningful but opaque. A caller cannot tell a strong match from a weak one, compare results across queries, merge semantic and keyword hits on a common scale, or explain why a result came first. Agents either trust the order blindly or layer their own scorer on top.

**Workaround.** Queen scores every returned summary locally in `scoreSearchResults` (`tui/src/functions/action/cli.ts`), keeping the server order only as a tie-breaker. The scoring itself lives in `relevanceScores` (`tui/src/functions/analytics/relevance.ts`), described in detail below. The JSON payload preserves the original response and adds `query` plus a per-result `relevance`; the card can show a `rel.` percentage when `showRelevanceScores` is enabled.

**Suggested upstream fix.** Return a per-result `score`, `distance`, or both, along with the embedding model and index version. Document the direction and scale, support `minScore`, and allow `--sort` in semantic mode.

## 2. Diarization is absent; speakers are `Unknown`

**Observed.** Speaker fields on the transcripts Queen consumes are routinely blank or `Unknown`. There is no stable per-speaker identity to anchor a quote, an action item, or a per-person metric.

**Impact.** Who-said-what is guesswork. Speaker-attributed summaries, sentiment, commitments, and analytics can look precise while being wrong. A placeholder such as `Unknown` is especially easy for a downstream consumer to mistake for a real label.

**Workaround.** `tui/src/utils/diarize-speaker.ts` applies a small text-only heuristic using greetings, backchannels, and turn order. It is explicitly marked `FIXME`, handles at most three parties, and marks inferred lines as such. It is a presentation aid, not diarization.

**Status and upstream ask.** This is probably future work upstream. The durable fix is audio-based diarization with stable anonymous IDs (`SPEAKER_00`, `SPEAKER_01`, …), per-line confidence, and an explicit `unknown` state. Until then, inferred labels should never be presented as ground truth.

## 3. JSON output is uneven, and agents are gated to the MCP server

**Observed.** `--json` is available on many commands (`bee version`, `bee me`, `bee now`, `bee changed`, and most resource commands), but it is not a universal contract. `bee status`, for example, is human-readable text only. Where JSON exists, it is usually the raw per-command payload rather than one versioned envelope, and errors are rendered as text. The supported agent surface is the MCP server; CLI-only behaviour has no MCP equivalent.

**Impact.** Shell pipelines and non-MCP clients have to scrape Markdown or special-case each command. More importantly, heuristics implemented above the CLI do not survive the process boundary: Queen's intent routing, local reranking, and inferred speaker labels are usable by a human at the terminal, but another agent cannot compose them unless it reimplements them or wraps them in a new MCP tool. That is the "heuristic-based machine processing is undone" problem.

**Workaround.** Queen emits one stable envelope, `{ok, kind, command, elapsedMs, error?, data}` (`jsonEnvelope` in `tui/src/functions/action/cli.ts`), with `data` carrying the resource payload. This makes `queen ... --json | jq .data` a usable machine path regardless of the underlying command. Queen runs Bee's resource registry in-process; when a tool returns only prose, `callBeeTextTool` (`bee-cli/sources/commands/mcpToolOutput.ts`) parses JSON if possible and otherwise wraps the text as `{value: text}`. That adapter is a local workaround, not an upstream guarantee.

**Suggested upstream fix.** Make `--json` mandatory and uniform for every command and action, with a versioned envelope, structured errors, and a documented schema. If client-side heuristics matter to agents, expose the same operations as MCP tools instead of requiring every consumer to rebuild them.

## Mitigation in depth: PFA-based relevance

The first friction is the one Queen actively mitigates. Rather than accepting neural order as ground truth, Queen computes an explicit local relevance score with Principal Factor Analysis (PFA), published as `factor-js`.

### How it works

1. Tokenize the query and each candidate summary; drop stopwords and very short terms.
2. Build a TF-IDF matrix over the combined vocabulary (capped at 200 terms).
3. Standardize each term column across documents to zero mean and unit variance.
4. Run PFA (`runFactor` → `factor-js`) to obtain factor loadings, explained variance, and per-document factor scores.
5. Project the query into the same factor space and compute cosine similarity against each document's factor scores, clamped to `[0, 1]`.
6. Fall back to plain TF-IDF cosine similarity when there are too few documents or terms, or when factor analysis is not viable.
7. In keyword mode, min-max normalize the server's BM25 score and combine it with local relevance using a harmonic mean. In semantic mode, where no server score exists, local relevance is the ranking signal.

### Why this helps

- **Transparent.** Loadings show which terms define each factor, variance shows how much signal the model captures, and every document has an explicit score. The ranking is inspectable rather than an opaque remote order.
- **Not blind.** Semantic results are reordered by a stated criterion instead of being accepted as-is; keyword results gain a second, query-aware signal.
- **Deterministic and offline.** The same inputs produce the same scores, with no extra network round-trip.
- **Integrated.** The same PFA machinery powers Queen's factor-analysis views, so this is not a one-off scorer bolted onto search.

### Adoption caveat

PFA is early. At the time of writing (October 2026), `factor-js` has about 14 weekly npm downloads, compared with about 3,039 for `pca-js`. Both packages are by the same author, and `pca-js` is the mature predecessor. PFA follows the same SVD/eigenvector approach, and its results are cross-checked against NumPy and `factor-analyzer`; low adoption is still a fair reason for caution, which is why Queen keeps a deterministic TF-IDF fallback.

### Limits

This is a local scoring layer over the returned page, not a replacement for a server-side neural relevance score. TF-IDF is lexical, so a valid semantic hit with no term overlap can score low. The mitigation makes the retrieved page more transparent and prevents purely blind ordering; the upstream fix—exposing real relevance scores—remains the better solution.

## Urls
- [`factor-js`](https://www.npmjs.com/package/factor-js) · [`pca-js`](https://www.npmjs.com/package/pca-js)
- [`bitanath/factor`](https://github.com/bitanath/factor) · [`bitanath/pca`](https://github.com/bitanath/pca)
