(() => {
    const DEFAULT_AVATAR = "📘";
    const BUCKET = "photolex-avatars";
    const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const AVATAR_URL_TTL_MS = 50 * 60 * 1000;
    const EXPIRES_KEY = "photolex.app.expiresAt";
    const USER_ID_KEY = "photolex.app.userId";
    const EXPIRED_KEY = "photolex.app.expired";
    const PROFILE_CACHE_PREFIX = "photolex.profile.";
    const AVATAR_CACHE_PREFIX = "photolex.avatarUrl.";
    let watchedClient = null;
    let expiryTimer = null;

    function clearAppCache() {
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
            const key = localStorage.key(index);
            if (key && (key.startsWith(PROFILE_CACHE_PREFIX) || key.startsWith(AVATAR_CACHE_PREFIX))) {
                localStorage.removeItem(key);
            }
        }
        localStorage.removeItem(EXPIRES_KEY);
        localStorage.removeItem(USER_ID_KEY);
        localStorage.removeItem(EXPIRED_KEY);
    }

    function scheduleExpiration(client, expiresAt) {
        if (expiryTimer) clearTimeout(expiryTimer);
        expiryTimer = setTimeout(async () => {
            clearAppCache();
            localStorage.setItem(EXPIRED_KEY, "1");
            try { await client.auth.signOut({ scope: "local" }); } catch {}
            if (!location.pathname.endsWith("login.html")) location.href = "login.html";
        }, Math.max(0, expiresAt - Date.now()));
    }

    function startSession(user) {
        clearAppCache();
        if (user?.id) localStorage.setItem(USER_ID_KEY, user.id);
        localStorage.setItem(EXPIRES_KEY, String(Date.now() + SESSION_TTL_MS));
    }

    function watchAuth(client) {
        if (watchedClient === client) return;
        watchedClient = client;
        client.auth.onAuthStateChange(event => {
            if (event === "SIGNED_OUT") clearAppCache();
        });
    }

    async function getCurrentUser(client) {
        watchAuth(client);
        const { data: { session }, error } = await client.auth.getSession();
        if (error || !session?.user) {
            clearAppCache();
            return null;
        }

        const user = session.user;
        if (localStorage.getItem(EXPIRED_KEY) === "1") {
            try { await client.auth.signOut({ scope: "local" }); } catch {}
            return null;
        }
        const cachedUserId = localStorage.getItem(USER_ID_KEY);
        let expiresAt = Number(localStorage.getItem(EXPIRES_KEY));
        if (!expiresAt || !cachedUserId || cachedUserId !== user.id) {
            startSession(user);
            expiresAt = Date.now() + SESSION_TTL_MS;
        }
        if (Date.now() >= expiresAt) {
            clearAppCache();
            localStorage.setItem(EXPIRED_KEY, "1");
            try { await client.auth.signOut({ scope: "local" }); } catch {}
            return null;
        }
        scheduleExpiration(client, expiresAt);
        return user;
    }
    async function getUserInformation(client, user) {
        const cacheKey = PROFILE_CACHE_PREFIX + user.id;
        try {
            const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
            if (cached?.expiresAt > Date.now() && cached?.data?.auth_user_id === user.id) {
                return { data: cached.data, error: null };
            }
        } catch {
            localStorage.removeItem(cacheKey);
        }

        const { data, error } = await client
            .from("user_information")
            .select("id,user_name,auth_user_id")
            .eq("auth_user_id", user.id)
            .single();
        if (!error && data) {
            const sessionExpiresAt = Number(localStorage.getItem(EXPIRES_KEY)) || Date.now() + SESSION_TTL_MS;
            localStorage.setItem(cacheKey, JSON.stringify({
                data,
                expiresAt: Math.min(Date.now() + SESSION_TTL_MS, sessionExpiresAt)
            }));
        }
        return { data, error };
    }

    function avatarFor(user) {
        return user?.user_metadata?.photolex_avatar || DEFAULT_AVATAR;
    }

    function invalidateAvatar(path) {
        if (path) localStorage.removeItem(AVATAR_CACHE_PREFIX + path);
    }

    async function paint(client, user) {
        const path = user?.user_metadata?.photolex_avatar_path;
        let signedUrl = null;
        if (path) {
            const cacheKey = AVATAR_CACHE_PREFIX + path;
            try {
                const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
                if (cached?.expiresAt > Date.now()) signedUrl = cached.url;
            } catch {
                localStorage.removeItem(cacheKey);
            }
            if (!signedUrl) {
                const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
                if (!error && data?.signedUrl) {
                    signedUrl = data.signedUrl;
                    localStorage.setItem(cacheKey, JSON.stringify({
                        url: signedUrl,
                        expiresAt: Date.now() + AVATAR_URL_TTL_MS
                    }));
                }
            }
        }
        document.querySelectorAll("[data-profile-avatar]").forEach(element => {
            if (!signedUrl) {
                element.textContent = avatarFor(user);
                return;
            }
            const image = document.createElement("img");
            image.className = "user-avatar-photo";
            image.alt = "";
            image.src = signedUrl;
            element.replaceChildren(image);
        });
    }

    window.PhotoLexProfile = {
        DEFAULT_AVATAR,
        BUCKET,
        startSession,
        getCurrentUser,
        getUserInformation,
        avatarFor,
        invalidateAvatar,
        paint
    };
})();