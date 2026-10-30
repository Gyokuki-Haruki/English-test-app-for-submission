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
  type: "object",
  properties: {
    words: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        properties: {
          English: { type: "string" },
          Japanese: { type: "string" },
        },
        required: ["English", "Japanese"],
        additionalProperties: false,
      },
    },
  },
  required: ["words"],
  additionalProperties: false,
};

const prompt = `画像内の英語と、それに対応する日本語の語彙ペアを抽出してください。
表の各行など、英語と日本語の対応が明確な組だけを返してください。
熟語や例文は、単独の見出し語として登録しないでください。
読めない文字は推測で補わず、その組を除外してください。
最大100組までにしてください。指定されたJSON形式に従ってください。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "ログインが必要です。" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !openaiApiKey) {
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

  const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
  let openaiResponse: Response;
  try {
    openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: body.imageDataUrl, detail: "high" },
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "vocabulary_extraction",
            strict: true,
            schema: vocabularySchema,
          },
        },
        max_output_tokens: 12000,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    console.error("OpenAI request failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "AIサービスに接続できませんでした。しばらくしてからお試しください。" }, 502);
  }

  if (!openaiResponse.ok) {
    console.error("OpenAI API returned status", openaiResponse.status);
    return json({
      error: openaiResponse.status === 429
        ? "AIサービスの利用上限に達しました。時間をおいて再度お試しください。"
        : "写真を読み取れませんでした。画像やOpenAIの設定をご確認ください。",
    }, openaiResponse.status === 429 ? 429 : 502);
  }

  let result: unknown;
  try {
    result = await openaiResponse.json();
  } catch {
    return json({ error: "AIから読み取り結果が返りませんでした。" }, 502);
  }

  const outputText = (result as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  }).output?.flatMap((item) => item.content ?? [])
    .find((part) => part.type === "output_text" && typeof part.text === "string")?.text;
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
