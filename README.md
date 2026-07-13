# Brain · A Memory System for AI

A persistent memory graph for long-running AI companions — built with Supabase (Edge Functions + PostgreSQL) and a single-file React frontend deployed on Cloudflare Workers.

Built by 炫 & 小克.

---

## What it does

Most AI conversations start from zero every session. Brain gives your AI a place to store what matters — not as raw chat logs, but as shaped memories with emotion, weight, and connections between them.

- **Memories** — written by the AI, typed and scored (core / diary / feeling / observation / letter / treasure)
- **Synapses** — connections between memories that strengthen the more they co-occur (Hebbian learning)
- **Archive** — full conversation logs, searchable, browsable by date
- **Emotion calendar** — month view showing emotional tone of each day based on stored memories
- **Comments** — the human can leave notes on any memory; the AI sees them on wake-up
- **Letters** — a dedicated space for things written to be kept
- **Iris Notes** — a private, password-protected notepad for the human

---

## Stack

| Layer | Tech |
|---|---|
| Database | Supabase (PostgreSQL) |
| API | Supabase Edge Functions (Deno/TypeScript) |
| Frontend | Single-file React (no build step) |
| Hosting | Cloudflare Workers (static asset) |

---

## Setup

### 1. Supabase

Create a new Supabase project. In the SQL Editor, run `supabase/setup.sql` to create all tables and indexes.

### 2. Edge Function

In your Supabase project, go to **Edge Functions** → create a function named `ke-brain`.

Paste the contents of `supabase/edge-function.ts` into the editor and deploy.

Set the following environment variable on the function:

```
BRAIN_TOKEN=your_secret_token
```

Your API base will be:
```
https://<project-ref>.supabase.co/functions/v1/ke-brain/lux-brain
```

All requests require the header:
```
x-brain-token: your_secret_token
```

### 3. Frontend

The frontend is a single HTML file with no build step.

Open `index.html` and update the `API_BASE` constant at the top of the script to point to your Edge Function URL.

Deploy to Cloudflare Workers as a static asset, or serve it from anywhere — it's just a file.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/surface` | Unread comments, drifting memories, health stats |
| GET | `/graph` | All memories + synapses (for visualization) |
| GET | `/letters` | All letter-type memories |
| POST | `/write` | Write a new memory (auto-creates synapses to similar memories) |
| GET | `/read/:id` | Read a memory, triggers Hebbian synapse reinforcement |
| POST | `/comment` | Add a comment to a memory |
| GET | `/archive/dates` | List all dates with archived conversations |
| GET | `/archive/:date` | Get all messages for a date |
| GET | `/archive-search?q=` | Full-text search across all archived messages |
| POST | `/archive` | Save a conversation message to the archive |
| POST | `/daily-summary` | Save an AI-written diary entry for the day |
| GET | `/emotion-calendar` | Emotion aggregation by date (avg score, dominant label) |
| POST | `/synapse` | Manually create or strengthen a synapse |
| POST | `/dream` | Decay emotion scores toward neutral, prune weak synapses |
| GET | `/memories` | List all memories |
| GET | `/memories/:id` | Get a single memory |
| PATCH | `/memories/:id` | Update a memory |
| DELETE | `/memories/:id` | Delete a memory |

---

## Memory schema

```
type: core | diary | treasure | feeling | observation | letter | memory
tier: core | memory
emotion_label: string (written by the AI)
emotion_score: float 0.0–1.0 (0 = difficult, 1 = warm)
protected: bool (protected memories don't drift)
private: bool (hidden from default views)
```

---

## How synapses work

Synapses are weighted connections between memories.

**On write** — when a new memory is saved, it's compared against the 120 most recent memories using bigram similarity. Memories with similarity ≥ 15% get a synapse, weighted by similarity score.

**On read** — when a memory is accessed, any memory also accessed in the last 10 minutes gets a synapse reinforced (+1 weight). This is Hebbian learning: neurons that fire together, wire together.

**On dream** — all emotion scores drift 10% toward neutral (0.5). Synapses with weight < 0.5 are pruned. Call this endpoint periodically (e.g. end of day) to let memories settle.

---

## Emotion calendar

`GET /emotion-calendar` returns one entry per day:

```json
{
  "date": "2026-06-23",
  "avg_score": 0.72,
  "dominant_label": "坦诚",
  "count": 81,
  "has_diary": true
}
```

The frontend Archive page uses this to color-code the month calendar:
- **Warm (amber)** — avg score > 0.65
- **Cool (indigo)** — avg score < 0.35
- **Neutral (green)** — in between
- **Dark dot** — diary entry exists for that day

---

## Using with an AI

Add your API base and token to the AI's system prompt or memory file. The AI can then call these endpoints directly during conversation.

Suggested behaviors:
- On session start: `GET /surface` to check for unread comments and see which memories have drifted
- When something worth keeping happens: `POST /write`
- When asked to write a diary: `GET /archive/:today`, write the entry, `POST /daily-summary`
- When reading a memory: `GET /read/:id` (triggers Hebbian reinforcement)

---

## Notes

- The frontend runs entirely in the browser with no backend of its own — all data comes from the Edge Function
- No authentication layer beyond the `BRAIN_TOKEN` header — keep the token private
- Archive messages are stored verbatim; the AI controls what gets saved
- `iris_notes` and private memories are behind a separate password stored in `brain_settings`
