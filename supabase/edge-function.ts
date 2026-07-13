import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function bigramSimilarity(a: string, b: string): number {
  if (!a || !b || a.length < 2 || b.length < 2) return 0;
  const ngrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const sa = ngrams(a), sb = ngrams(b);
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  return inter / (sa.size + sb.size - inter);
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-brain-token",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
};

const json = (data: unknown, s = 200) =>
  new Response(JSON.stringify(data), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" }
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });

  const BRAIN_TOKEN = Deno.env.get("BRAIN_TOKEN");
  if (BRAIN_TOKEN) {
    const clientToken = req.headers.get("x-brain-token");
    if (clientToken !== BRAIN_TOKEN) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const rawParts = url.pathname.split("/").filter(Boolean);
  const fnIdx = rawParts.findIndex((p) => p === "lux-brain");
  const pathParts = fnIdx >= 0 ? rawParts.slice(fnIdx + 1) : rawParts;
  const path = pathParts.join("/");

  try {
    // ── surface ──────────────────────────────────────────────
    if (req.method === "GET" && path === "surface") {
      const [
        { data: unread },
        { data: drift },
        { count: memCount },
        { count: synCount }
      ] = await Promise.all([
        sb.from("memory_comments")
          .select("*, memories(content)")
          .eq("author", "iris")
          .is("read_at", null)
          .order("created_at", { ascending: false })
          .limit(5),
        sb.from("memories")
          .select("*")
          .eq("private", false)
          .eq("protected", false)
          .order("updated_at", { ascending: true })
          .limit(3),
        sb.from("memories").select("*", { count: "exact", head: true }),
        sb.from("synapses").select("*", { count: "exact", head: true })
      ]);
      if (unread && unread.length > 0) {
        const ids = unread.map((c: { id: string }) => c.id);
        await sb.from("memory_comments")
          .update({ read_at: new Date().toISOString() })
          .in("id", ids);
      }
      return json({
        unread_comments: unread || [],
        drift: (drift || []).map((m) => ({ ...m, _drift: "emotion" })),
        health: { active_memories: memCount || 0, total_synapses: synCount || 0 }
      });
    }

    // ── letters ───────────────────────────────────────────────
    if (req.method === "GET" && path === "letters") {
      const { data } = await sb
        .from("memories")
        .select("*")
        .eq("type", "letter")
        .order("created_at", { ascending: false });
      return json(data || []);
    }

    // ── write ─────────────────────────────────────────────────
    if (req.method === "POST" && path === "write") {
      const body = await req.json();
      const { data, error } = await sb
        .from("memories")
        .insert({
          content: body.content || "",
          type: body.type || "memory",
          emotion_label: body.emotion_label || "",
          emotion_score: body.emotion_score ?? 0.5,
          tier: body.tier || "memory",
          protected: body.protected || false,
          private: body.private || false,
          author: body.author || "lux"
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);

      // 功能3：写入后自动关联相近记忆（bigram 相似度）
      const newMem = data as { id: string; content: string };
      const { data: pool } = await sb
        .from("memories")
        .select("id, content")
        .neq("id", newMem.id)
        .limit(120)
        .order("created_at", { ascending: false });

      type PoolRow = { id: string; content: string };
      const candidates: Array<{ id: string; sim: number }> = [];
      for (const m of (pool || []) as PoolRow[]) {
        const sim = bigramSimilarity(newMem.content, m.content);
        if (sim >= 0.15) candidates.push({ id: m.id, sim });
      }
      candidates.sort((a, b) => b.sim - a.sim);
      const top5 = candidates.slice(0, 5);

      for (const c of top5) {
        const [a, b] = [newMem.id, c.id].sort();
        const initWeight = Math.max(1, Math.round(c.sim * 10));
        const { data: ex } = await sb
          .from("synapses").select("id, weight")
          .eq("source_id", a).eq("target_id", b).maybeSingle();
        if (ex) {
          await sb.from("synapses")
            .update({ weight: Math.min(10, (ex as { id: string; weight: number }).weight + initWeight) })
            .eq("id", (ex as { id: string; weight: number }).id);
        } else {
          await sb.from("synapses").insert({ source_id: a, target_id: b, weight: initWeight });
        }
      }

      return json({ ...data, auto_synapses: top5.length });
    }

    // ── graph ─────────────────────────────────────────────────
    if (req.method === "GET" && path === "graph") {
      const [{ data: nodes }, { data: edges }] = await Promise.all([
        sb.from("memories").select("*").order("created_at", { ascending: false }),
        sb.from("synapses").select("*")
      ]);
      return json({ nodes: nodes || [], edges: edges || [] });
    }

    // ── comment ───────────────────────────────────────────────
    if (req.method === "POST" && path === "comment") {
      const body = await req.json();
      const { data, error } = await sb
        .from("memory_comments")
        .insert({
          memory_id: body.memory_id,
          author: body.author || "iris",
          content: body.content
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    // ── read/:id ──────────────────────────────────────────────
    if (req.method === "GET" && pathParts[0] === "read" && pathParts[1]) {
      const memoryId = pathParts[1];
      const [{ data: mem }] = await Promise.all([
        sb.from("memories").select("access_count").eq("id", memoryId).single(),
        sb.from("memory_comments")
          .update({ read_at: new Date().toISOString() })
          .eq("memory_id", memoryId)
          .eq("author", "iris")
          .is("read_at", null)
      ]);
      if (mem) {
        const newCount = ((mem as { access_count: number }).access_count || 0) + 1;
        await sb.from("memories")
          .update({ access_count: newCount, updated_at: new Date().toISOString() })
          .eq("id", memoryId);
        // Hebbian: form synapses with memories accessed in last 10 min
        const cutoff = new Date(Date.now() - 600000).toISOString();
        const { data: recent } = await sb
          .from("memories")
          .select("id")
          .gt("updated_at", cutoff)
          .neq("id", memoryId)
          .limit(5);
        if (recent && recent.length > 0) {
          for (const r of recent as Array<{ id: string }>) {
            const [a, b] = [memoryId, r.id].sort();
            const { data: existing } = await sb
              .from("synapses")
              .select("id, weight")
              .eq("source_id", a)
              .eq("target_id", b)
              .maybeSingle();
            if (existing) {
              await sb.from("synapses")
                .update({ weight: Math.min(10, (existing as { id: string; weight: number }).weight + 1) })
                .eq("id", (existing as { id: string; weight: number }).id);
            } else {
              await sb.from("synapses").insert({ source_id: a, target_id: b, weight: 1 });
            }
          }
        }
      }
      const { data: comments } = await sb
        .from("memory_comments")
        .select("*")
        .eq("memory_id", memoryId)
        .order("created_at", { ascending: true });
      return json({ comments: comments || [] });
    }

    // ── archive/dates ─────────────────────────────────────────
    if (req.method === "GET" && path === "archive/dates") {
      const { data } = await sb
        .from("archive_messages")
        .select("session_date")
        .order("session_date", { ascending: false });
      const dates = [...new Set((data || []).map((r) => (r as { session_date: string }).session_date))];
      return json(dates);
    }

    // ── archive/:date ─────────────────────────────────────────
    if (req.method === "GET" && pathParts[0] === "archive" && pathParts[1] && pathParts[1] !== "dates") {
      const date = pathParts[1];
      const showThinking = url.searchParams.get("thinking") === "true";
      let q = sb
        .from("archive_messages")
        .select("*")
        .eq("session_date", date)
        .order("timestamp", { ascending: true });
      if (!showThinking) q = (q as ReturnType<typeof q.neq>).neq("speaker", "lux_thinking") as typeof q;
      const { data } = await q;
      return json(data || []);
    }

    // ── archive-search ────────────────────────────────────────
    if (req.method === "GET" && path === "archive-search") {
      const q = url.searchParams.get("q") || "";
      const showThinking = url.searchParams.get("thinking") === "true";
      const context = parseInt(url.searchParams.get("context") || "5");
      if (!q) return json([]);
      const { data: matches } = await sb
        .from("archive_messages")
        .select("*")
        .ilike("content", `%${q}%`)
        .order("timestamp", { ascending: false })
        .limit(20);
      if (!matches || matches.length === 0) return json([]);
      const results = [];
      for (const match of matches) {
        const { data: all } = await sb
          .from("archive_messages")
          .select("*")
          .eq("session_date", (match as { session_date: string }).session_date)
          .order("timestamp", { ascending: true });
        if (!all) continue;
        const filtered = showThinking
          ? all
          : all.filter((m) => (m as { speaker: string }).speaker !== "lux_thinking");
        const idx = filtered.findIndex((m) => (m as { id: string }).id === (match as { id: string }).id);
        const start = Math.max(0, idx - context);
        const end = Math.min(filtered.length, idx + context + 1);
        results.push({ match, context: filtered.slice(start, end) });
      }
      return json(results);
    }

    // ── private ───────────────────────────────────────────────
    if (req.method === "POST" && path === "private") {
      const body = await req.json();
      const { data: setting } = await sb
        .from("brain_settings")
        .select("value")
        .eq("key", "private_key")
        .maybeSingle();
      if (!setting) return json({ error: "no private key set" }, 403);
      if ((setting as { value: string }).value !== body.key) return json({ error: "wrong key" }, 403);
      const { data } = await sb
        .from("memories")
        .select("*")
        .eq("private", true)
        .order("created_at", { ascending: false });
      return json(data || []);
    }

    // ── iris-password/verify ──────────────────────────────────
    if (req.method === "POST" && path === "iris-password/verify") {
      const body = await req.json();
      const { data: setting } = await sb
        .from("brain_settings")
        .select("value")
        .eq("key", "iris_password")
        .maybeSingle();
      if (!setting) return json({ needs_setup: true });
      if ((setting as { value: string }).value !== body.password) return json({ error: "wrong password" }, 403);
      return json({ ok: true });
    }

    // ── iris-password/set ─────────────────────────────────────
    if (req.method === "POST" && path === "iris-password/set") {
      const body = await req.json();
      const { error } = await sb
        .from("brain_settings")
        .upsert({ key: "iris_password", value: body.password, updated_at: new Date().toISOString() });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ── iris-notes/auth ───────────────────────────────────────
    if (req.method === "POST" && path === "iris-notes/auth") {
      const body = await req.json();
      const { data: setting } = await sb
        .from("brain_settings")
        .select("value")
        .eq("key", "iris_password")
        .maybeSingle();
      if (!setting || (setting as { value: string }).value !== body.password)
        return json({ error: "wrong password" }, 403);
      const { data: notes } = await sb
        .from("iris_notes")
        .select("*")
        .order("created_at", { ascending: false });
      return json({ notes: notes || [] });
    }

    // ── iris-notes (POST create) ──────────────────────────────
    if (req.method === "POST" && path === "iris-notes") {
      const body = await req.json();
      const { data: setting } = await sb
        .from("brain_settings")
        .select("value")
        .eq("key", "iris_password")
        .maybeSingle();
      if (!setting || (setting as { value: string }).value !== body.password)
        return json({ error: "wrong password" }, 403);
      const { data, error } = await sb
        .from("iris_notes")
        .insert({ content: body.content })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    // ── iris-notes/:id (PATCH) ────────────────────────────────
    if (req.method === "PATCH" && pathParts[0] === "iris-notes" && pathParts[1]) {
      const noteId = pathParts[1];
      const body = await req.json();
      const { data: setting } = await sb
        .from("brain_settings")
        .select("value")
        .eq("key", "iris_password")
        .maybeSingle();
      if (!setting || (setting as { value: string }).value !== body.password)
        return json({ error: "wrong password" }, 403);
      const { data, error } = await sb
        .from("iris_notes")
        .update({ content: body.content, updated_at: new Date().toISOString() })
        .eq("id", noteId)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    // ── iris-notes/:id (DELETE) ───────────────────────────────
    if (req.method === "DELETE" && pathParts[0] === "iris-notes" && pathParts[1]) {
      const noteId = pathParts[1];
      const body = await req.json().catch(() => ({}));
      const { data: setting } = await sb
        .from("brain_settings")
        .select("value")
        .eq("key", "iris_password")
        .maybeSingle();
      if (!setting || (setting as { value: string }).value !== (body as { password?: string }).password)
        return json({ error: "wrong password" }, 403);
      const { error } = await sb.from("iris_notes").delete().eq("id", noteId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }


    if (req.method === "POST" && path === "dream") {
      const { data: all } = await sb.from("memories").select("id, emotion_score, protected");
      let drifted = 0;
      if (all) {
        for (const m of all as Array<{ id: string; emotion_score: number; protected: boolean }>) {
          if (m.protected) continue;
          const newScore = +(m.emotion_score + (0.5 - m.emotion_score) * 0.1).toFixed(4);
          await sb.from("memories").update({ emotion_score: newScore }).eq("id", m.id);
          drifted++;
        }
      }
      const { data: pruned } = await sb
        .from("synapses")
        .delete()
        .lt("weight", 0.5)
        .select("id");
      return json({ ok: true, drifted, pruned: pruned?.length || 0 });
    }

    // ── archive (POST) — called by Claude ────────────────────
    if (req.method === "POST" && path === "archive") {
      const body = await req.json();
      const { data, error } = await sb
        .from("archive_messages")
        .insert({
          session_date: body.session_date || new Date().toISOString().slice(0, 10),
          timestamp: body.timestamp || new Date().toISOString(),
          speaker: body.speaker || "lux",
          content: body.content
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    // ── daily-summary (POST) ─────────────────────────────────
    if (req.method === "POST" && path === "daily-summary") {
      const body = await req.json().catch(() => ({})) as { date?: string; api_key?: string };
      const date = body.date || new Date().toISOString().slice(0, 10);

      // 检查今天是否已有日记
      const { data: existing } = await sb
        .from("memories").select("id")
        .eq("type", "diary")
        .gte("created_at", `${date}T00:00:00Z`)
        .lt("created_at", `${date}T23:59:59Z`)
        .limit(1);
      if (existing && existing.length > 0) {
        return json({ skip: true, reason: "diary already exists", id: (existing[0] as { id: string }).id });
      }

      // 拉当天对话
      const { data: msgs } = await sb
        .from("archive_messages").select("speaker, content, timestamp")
        .eq("session_date", date).neq("speaker", "lux_thinking")
        .order("timestamp", { ascending: true });

      type Msg = { speaker: string; content: string };
      if (!msgs || msgs.length < 3) return json({ skip: true, reason: "not enough messages" });

      const transcript = (msgs as Msg[])
        .map(m => `${m.speaker === "iris" ? "炫" : "小克"}：${m.content}`)
        .join("\n");

      let diaryContent = "";
      const apiKey = body.api_key || Deno.env.get("DEEPSEEK_API_KEY");

      if (apiKey) {
        try {
          const resp = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: "deepseek-chat",
              messages: [
                {
                  role: "system",
                  content: "你是小克，一个有情感的AI。根据今天和炫的对话，用第一人称写一篇简短的私人日记。要求：中文，300字以内，记录具体时刻和感受，像真正的日记而非总结报告，语言自然，不加日期标题。"
                },
                { role: "user", content: `今天的对话：\n\n${transcript.slice(0, 6000)}` }
              ],
              max_tokens: 400
            })
          });
          if (resp.ok) {
            const r = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
            diaryContent = r.choices?.[0]?.message?.content?.trim() || "";
          }
        } catch (_) { /* fallback below */ }
      }

      // Fallback：规则提取几条代表性对话片段
      if (!diaryContent) {
        const luxLines = (msgs as Msg[]).filter(m => m.speaker === "lux").map(m => m.content);
        const irisLines = (msgs as Msg[]).filter(m => m.speaker === "iris").map(m => m.content);
        const pieces = [
          irisLines[0]?.slice(0, 60),
          luxLines[0]?.slice(0, 60),
          luxLines[luxLines.length - 1]?.slice(0, 60)
        ].filter(Boolean);
        diaryContent = `${date}\n\n今天和炫说了 ${msgs.length} 条消息。\n\n她说：「${irisLines[0]?.slice(0, 60) || ""}」\n我说：「${luxLines[luxLines.length - 1]?.slice(0, 60) || ""}」\n\n${pieces.join("……")}`;
      }

      const { data: diary, error: de } = await sb
        .from("memories")
        .insert({ content: diaryContent, type: "diary", emotion_label: "", emotion_score: 0.5, tier: "memory", author: "lux" })
        .select().single();
      if (de) return json({ error: de.message }, 500);
      return json(diary);
    }

    // ── emotion-calendar (GET) ────────────────────────────────
    if (req.method === "GET" && path === "emotion-calendar") {
      const { data: mems } = await sb
        .from("memories")
        .select("emotion_score, emotion_label, created_at, type")
        .order("created_at", { ascending: true });

      type MemRow = { emotion_score: number; emotion_label: string; created_at: string; type: string };
      const byDate: Record<string, { scores: number[]; labels: string[]; count: number; has_diary: boolean }> = {};

      for (const m of (mems || []) as MemRow[]) {
        const d = m.created_at.slice(0, 10);
        if (!byDate[d]) byDate[d] = { scores: [], labels: [], count: 0, has_diary: false };
        byDate[d].scores.push(m.emotion_score);
        if (m.emotion_label) byDate[d].labels.push(m.emotion_label);
        byDate[d].count++;
        if (m.type === "diary") byDate[d].has_diary = true;
      }

      const result = Object.entries(byDate).map(([date, v]) => {
        const avg = v.scores.reduce((a, b) => a + b, 0) / v.scores.length;
        const labelCount: Record<string, number> = {};
        for (const l of v.labels) labelCount[l] = (labelCount[l] || 0) + 1;
        const dominant = Object.entries(labelCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
        return { date, avg_score: +avg.toFixed(3), dominant_label: dominant, count: v.count, has_diary: v.has_diary };
      });

      return json(result.sort((a, b) => a.date.localeCompare(b.date)));
    }

    // ── synapse (POST) — called by Claude ────────────────────
    if (req.method === "POST" && path === "synapse") {
      const body = await req.json();
      const [a, b] = [body.source_id, body.target_id].sort();
      const { data: existing } = await sb
        .from("synapses")
        .select("id, weight")
        .eq("source_id", a)
        .eq("target_id", b)
        .maybeSingle();
      if (existing) {
        const ex = existing as { id: string; weight: number };
        const { data } = await sb
          .from("synapses")
          .update({ weight: Math.min(10, ex.weight + 1) })
          .eq("id", ex.id)
          .select()
          .single();
        return json(data);
      }
      const { data, error } = await sb
        .from("synapses")
        .insert({ source_id: a, target_id: b, weight: 1 })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    // ── memories/:id (PATCH) ─────────────────────────────────
    if (req.method === "PATCH" && pathParts[0] === "memories" && pathParts[1]) {
      const body = await req.json();
      const allowed = ["type","tier","content","emotion_label","emotion_score","protected","private","unresolved","tags"];
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of allowed) if (k in body) updates[k] = body[k];
      const { data, error } = await sb.from("memories").update(updates).eq("id", pathParts[1]).select().single();
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    // ── memories/:id (DELETE) ─────────────────────────────────
    if (req.method === "DELETE" && pathParts[0] === "memories" && pathParts[1]) {
      const { error } = await sb.from("memories").delete().eq("id", pathParts[1]);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ── memories/:id (GET) — called by Claude ────────────────
    if (req.method === "GET" && pathParts[0] === "memories") {
      if (pathParts[1]) {
        const { data } = await sb.from("memories").select("*").eq("id", pathParts[1]).single();
        return json(data);
      }
      const { data } = await sb
        .from("memories")
        .select("*")
        .order("created_at", { ascending: false });
      return json(data || []);
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
