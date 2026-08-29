(() => {
  "use strict";

  const LAST_MODE_KEY = "mwPronunciationTool.lastVocabMode.v1";
  const SPEED_EXAMPLE_VALUE = "usage-example-speed";

  function injectStyles() {
    if (document.getElementById("uxOverridesStyle")) return;
    const style = document.createElement("style");
    style.id = "uxOverridesStyle";
    style.textContent = `
      .word-card .caution,
      .readiness-summary .risk-list {
        display: none !important;
      }

      #recallPanel.example-speed-review .recall-ratings {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      #recallPanel.example-speed-review .recall-ratings .rating {
        min-height: 50px;
        width: 100%;
        font-size: 1rem;
        line-height: 1.2;
      }
    `;
    document.head.appendChild(style);
  }

  function isMemoryModeSelect(select) {
    return [...select.options].some(option => option.value.startsWith("memory-"));
  }

  function desiredVocabModeMarkup() {
    return `
      <optgroup label="高速周回">
        <option value="speed">単語・高速周回</option>
        <option value="${SPEED_EXAMPLE_VALUE}">例文・高速周回</option>
      </optgroup>
      <optgroup label="例文">
        <option value="usage-example-unsettled">未定着の例文</option>
        <option value="usage-example-all">全例文</option>
        <option value="usage-all-all">例文・熟語（全範囲）</option>
      </optgroup>
      <optgroup label="単語テスト">
        <option value="word-enToJa-normal">英語→日本語・通常</option>
        <option value="word-jaToEn-normal">日本語→英語・通常</option>
        <option value="word-enToJa-wrong">英語→日本語・間違い集中</option>
        <option value="word-jaToEn-wrong">日本語→英語・間違い集中</option>
      </optgroup>
      <optgroup label="仕上げ">
        <option value="ready-enToJa">満点確認・英語→日本語</option>
        <option value="ready-jaToEn">満点確認・日本語→英語</option>
        <option value="spelling">スペル確認</option>
      </optgroup>`;
  }

  function isDesiredModeLayout(select) {
    const labels = [...select.querySelectorAll("optgroup")].map(group => group.label);
    return labels.join("|") === "高速周回|例文|単語テスト|仕上げ" &&
      Boolean(select.querySelector(`option[value="${SPEED_EXAMPLE_VALUE}"]`));
  }

  function patchLearningModes() {
    const select = document.getElementById("testMode");
    if (!select || isMemoryModeSelect(select) || isDesiredModeLayout(select)) return;

    const previous = select.value;
    const saved = sessionStorage.getItem(LAST_MODE_KEY) || "";
    select.innerHTML = desiredVocabModeMarkup();

    const preferred = [saved, previous, "speed"].find(value =>
      value && [...select.options].some(option => option.value === value)
    );
    select.value = preferred || "speed";
  }

  function rememberSelectedMode(event) {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.id !== "testMode" || isMemoryModeSelect(select)) return;
    sessionStorage.setItem(LAST_MODE_KEY, select.value);
  }

  function setExampleSpeedFlag() {
    const select = document.getElementById("testMode");
    document.documentElement.dataset.exampleSpeedReview = select?.value === SPEED_EXAMPLE_VALUE ? "1" : "0";
  }

  function patchExampleSpeedRecall() {
    const panel = document.getElementById("recallPanel");
    const content = document.getElementById("recallContent");
    if (!panel || !content) return;

    const active = document.documentElement.dataset.exampleSpeedReview === "1" && !panel.classList.contains("hidden");
    panel.classList.toggle("example-speed-review", active);
    if (!active) return;

    const resultHeading = content.querySelector(".test-result h2");
    if (resultHeading) resultHeading.textContent = "例文 高速周回 完了";

    const headLabel = content.querySelector(".recall-head span:first-child");
    if (headLabel) headLabel.textContent = "例文・高速周回";

    const prompt = content.querySelector(".recall-prompt-label");
    if (prompt) prompt.textContent = "日本語を見て英文を即答";

    const reveal = content.querySelector('[data-recall-action="reveal"]');
    if (reveal) reveal.textContent = "英文を表示";

    const labels = {
      cross: "知らない",
      triangle: "怪しい",
      circle: "即答"
    };
    Object.entries(labels).forEach(([rating, label]) => {
      const button = content.querySelector(`[data-recall-rating="${rating}"]`);
      if (button) {
        button.textContent = label;
        button.setAttribute("aria-label", label);
      }
    });

    const resultNote = content.querySelector(".test-result .meta");
    if (resultNote) {
      resultNote.textContent = "「知らない」「怪しい」は同じ周回内で再出題します。即答できるまで絞り込みます。";
    }
  }

  function removeVerboseRiskDetails(root = document) {
    root.querySelectorAll?.(".readiness-summary .risk-list").forEach(element => element.remove());
    root.querySelectorAll?.(".word-card .caution").forEach(element => element.remove());
  }

  function refreshUi() {
    patchLearningModes();
    patchExampleSpeedRecall();
    removeVerboseRiskDetails();
  }

  injectStyles();
  refreshUi();

  document.addEventListener("change", rememberSelectedMode);
  document.getElementById("startSelectedMode")?.addEventListener("click", setExampleSpeedFlag, true);

  const observer = new MutationObserver(() => refreshUi());
  observer.observe(document.body, { childList: true, subtree: true });
})();
