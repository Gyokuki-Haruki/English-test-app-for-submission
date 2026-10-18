# English-test-app-for-submission
PhotoLexのコードを提出用にSupabaseのIDやKeyを削除したもの
削除した個所は下の通り
- Supabase URL：`index.html` 335行目、`login.html` 188行目、`mywords.html` 96行目、`test_setting.html` 123行目、`test.html` 218行目、`words.html` 393行目
- Supabase Publishable／anon key：`index.html` 338行目、`login.html` 189行目、`mywords.html` 97行目、`test_setting.html` 124行目、`test.html` 219行目、`words.html` 396行目
- Supabase Project ID：`supabase/config.toml` 1行目
- Gemini APIキー：SupabaseのEdge Function Secretsに `GEMINI_API_KEY` として登録
