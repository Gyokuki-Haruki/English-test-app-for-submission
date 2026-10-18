import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const vocabularySchema = {
  type: "OBJECT",
  properties: {
    words: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          English: { type: "STRING" },
          Japanese: { type: "STRING" },
        },
        required: ["English", "Japanese"],
      },
    },
  },
  required: ["words"],
};

const prompt = `画像内の英語と、それに対応する日本語の語彙ペアを抽出してください。
表の各行など、英語と日本語の対応が明確な組だけを返してください。
熟語や例文は、単独の見出し語として登録しないでください。
読めない文字は推測で補わず、その組を除外してください。
指定されたJSON形式に従ってください。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "ログインが必要です。" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !geminiApiKey) {
    console.error("Required Edge Function environment variable is missing");
    return json({ error: "サーバーの設定が不足しています。管理者にお問い合わせください。" }, 500);
  }

  // Verify the caller with Supabase Auth; never trust a user id from the request body.
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return json({ error: "ログイン状態を確認できません。再ログインしてください。" }, 401);

  let body: { imageDataUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "リクエスト形式が正しくありません。" }, 400);
  }
  if (typeof body.imageDataUrl !== "string") return json({ error: "画像がありません。" }, 400);

  const match = body.imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return json({ error: "JPEG、PNG、WebP画像を選択してください。" }, 400);
  const [, mimeType, encoded] = match;
  if (encoded.length > 11_200_000) return json({ error: "画像は8MB以下にしてください。" }, 413);

  let imageBytes: string;
  try {
    imageBytes = atob(encoded);
  } catch {
    return json({ error: "画像データを読み取れません。" }, 400);
  }
  if (imageBytes.length > 8 * 1024 * 1024) return json({ error: "画像は8MB以下にしてください。" }, 413);

  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash-lite";
  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: encoded } },
            ],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: vocabularySchema,
            temperature: 0.1,
          },
        }),
        signal: AbortSignal.timeout(90_000),
      },
    );
  } catch (error) {
    console.error("Gemini request failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "AIサービスに接続できませんでした。しばらくしてからお試しください。" }, 502);
  }

  if (!geminiResponse.ok) {
    console.error("Gemini API returned status", geminiResponse.status);
    return json({
      error: geminiResponse.status === 429
        ? "AIサービスの利用上限に達しました。時間をおいて再度お試しください。"
        : "写真を読み取れませんでした。画像やGeminiの設定をご確認ください。",
    }, geminiResponse.status === 429 ? 429 : 502);
  }

  let result: unknown;
  try {
    result = await geminiResponse.json();
  } catch {
    return json({ error: "AIから読み取り結果が返りませんでした。" }, 502);
  }

  const outputText = (result as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }).candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  if (typeof outputText !== "string") return json({ error: "AIから読み取り結果が返りませんでした。" }, 502);

  try {
    const parsed: unknown = JSON.parse(outputText);
    const rawWords = (parsed as { words?: unknown })?.words;
    const words = Array.isArray(rawWords)
      ? rawWords.slice(0, 100).flatMap((word: unknown) => {
        if (!word || typeof word !== "object") return [];
        const entry = word as { English?: unknown; Japanese?: unknown };
        if (typeof entry.English !== "string" || typeof entry.Japanese !== "string") return [];
        const English = entry.English.trim().slice(0, 200);
        const Japanese = entry.Japanese.trim().slice(0, 300);
        return English && Japanese ? [{ English, Japanese }] : [];
      })
      : [];
    return json({ words });
  } catch {
    return json({ error: "AIの読み取り結果を処理できませんでした。" }, 502);
  }
});
