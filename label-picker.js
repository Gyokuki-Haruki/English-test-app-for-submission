(function () {
    const CREATE_VALUE = "__PHOTOLEX_CREATE_LABEL__";

    function populate(select, labels, selectedValue) {
        if (!select) return;
        const current = selectedValue === undefined ? select.value : selectedValue;
        const unique = [...new Set(
            (labels || [])
                .map(label => String(label || "").trim())
                .filter(Boolean)
        )]
            .sort((a, b) => a.localeCompare(b, "ja"));
        if (current && current !== CREATE_VALUE && !unique.includes(current)) unique.push(current);

        select.replaceChildren();
        select.add(new Option("ラベルなし", ""));
        unique.forEach(label => select.add(new Option(label, label)));
        select.add(new Option("＋ 新しいラベルを作成", CREATE_VALUE));
        select.value = current || "";
        if (select.value !== current && current !== CREATE_VALUE) select.value = "";
        sync(select);
    }

    function sync(select) {
        const input = document.getElementById(select.dataset.newLabelInput || "");
        if (!input) return;
        const creating = select.value === CREATE_VALUE;
        input.hidden = !creating;
        input.style.display = creating ? "" : "none";
        if (creating) input.focus();
    }

    function attach(select, input) {
        if (!select || !input) return;
        select.dataset.newLabelInput = input.id;
        if (select.dataset.labelPickerReady) return;
        select.dataset.labelPickerReady = "true";
        select.addEventListener("change", () => {
            if (select.value !== CREATE_VALUE) input.value = "";
            sync(select);
        });
        sync(select);
    }

    function value(select, input) {
        if (!select) return "";
        return select.value === CREATE_VALUE ? String(input?.value || "").trim() : select.value;
    }

    function remember(labels, userId) {
        if (!userId) return;
        try {
            const uniqueLabels = [...new Set(
                (labels || [])
                    .map(label => String(label || "").trim())
                    .filter(Boolean)
            )];
            localStorage.setItem(
                `photolex.userLabels.${userId}`,
                JSON.stringify(uniqueLabels)
            );
        } catch (_) {
            // Label caching is optional; storage may be unavailable.
        }
    }

    function remembered(userId) {
        if (!userId) return [];
        try {
            const labels = JSON.parse(localStorage.getItem(`photolex.userLabels.${userId}`) || "[]");
            return Array.isArray(labels) ? labels.filter(x => typeof x === "string" && x.trim()) : [];
        } catch (_) {
            return [];
        }
    }

    window.PhotoLexLabels = { populate, attach, value, remember, remembered, CREATE_VALUE };
})();
