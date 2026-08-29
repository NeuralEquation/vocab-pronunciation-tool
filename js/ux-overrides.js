(() => {
  "use strict";

  const LAST_MODE_KEY = "mwPronunciationTool.lastVocabMode.v1";
  const SPEED_USAGE_VALUE = "usage-all-speed";

  function injectStyles() {
    if (document.getElementById("uxOverridesStyle")) return;
    const style = document.createElement("style");
    style.id = "uxOverridesStyle";
    style.textContent = `
      .word-card .caution,
      .readiness-summary .risk-list {
        display: none !important;
      }

      #recallPanel.usage-speed-review .recall-ratings {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      #recallPanel.usage-speed-review .recall-ratings .rating {
        min-height: 50px;
        width: 100%;
        font-size: 1rem;
        line-height: 1.2;
      }
    `;
    document.head.appendChild(style);
  }

  function setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function isMemoryModeSelect(select) {
    return [...select.options].some(option => option.value.startsWith("memory-"));
  }

  function desiredVocabModeMarkup() {
    return `
      <optgroup label="高速周回">
        <option value="speed">単語・高速周回</option>
        <option value="${SPEED_USAGE_VALUE}">例文・熟語・高速周回</option>
      </optgroup>
      <optgroup label="例文・熟語">
        <option value="usage-all-unsettled">未定着の例文・熟語</option>
        <option value="usage-all-all">全例文・熟語</option>
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
    return labels.join("|") === "高速周回|例文・熟語|単語テスト|仕上げ" &&
      Boolean(select.querySelector(`option[value="${SPEED_USAGE_VALUE}"]`)) &&
      ![...select.options].some(option => option.value.startsWith("usage-example-"));
  }

  function patchLearningModes() {
    const select = document.getElementById("testMode");
    if (!select || isMemoryModeSelect(select) || isDesiredModeLayout(select)) return;

    const previous = select.value;
    const saved = sessionStorage.getItem(LAST_MODE_KEY) || "";
    select.innerHTML = desiredVocabModeMarkup();

    const preferred = [saved, "speed", previous].find(value =>
      value && [...select.options].some(option => option.value === value)
    );
    select.value = preferred || "speed";
  }

  function rememberSelectedMode(event) {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.id !== "testMode" || isMemoryModeSelect(select)) return;
    sessionStorage.setItem(LAST_MODE_KEY, select.value);
  }

  function setUsageSpeedFlag() {
    const select = document.getElementById("testMode");
    document.documentElement.dataset.usageSpeedReview = select?.value === SPEED_USAGE_VALUE ? "1" : "0";
  }

  function patchUsageSpeedRecall() {
    const panel = document.getElementById("recallPanel");
    const content = document.getElementById("recallContent");
    if (!panel || !content) return;

    const currentHead = content.querySelector(".recall-head span:first-child")?.textContent || "";
    if (document.documentElement.dataset.usageSpeedReview === "1" && currentHead && !["例文", "熟語", "例文・熟語・高速周回"].includes(currentHead)) {
      document.documentElement.dataset.usageSpeedReview = "0";
    }

    const active = document.documentElement.dataset.usageSpeedReview === "1" && !panel.classList.contains("hidden");
    panel.classList.toggle("usage-speed-review", active);
    if (!active) return;

    setText(content.querySelector(".test-result h2"), "例文・熟語 高速周回 完了");
    setText(content.querySelector(".recall-head span:first-child"), "例文・熟語・高速周回");
    setText(content.querySelector(".recall-prompt-label"), "日本語を見て英文を即答");
    setText(content.querySelector('[data-recall-action="reveal"]'), "英文を表示");

    const labels = {
      cross: "知らない",
      triangle: "怪しい",
      circle: "即答"
    };
    Object.entries(labels).forEach(([rating, label]) => {
      const button = content.querySelector(`[data-recall-rating="${rating}"]`);
      if (!button) return;
      setText(button, label);
      if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
    });

    setText(
      content.querySelector(".test-result .meta"),
      "「知らない」「怪しい」は同じ周回内で再出題します。即答できるまで絞り込みます。"
    );
  }

  function removeVerboseRiskDetails(root = document) {
    root.querySelectorAll?.(".readiness-summary .risk-list").forEach(element => element.remove());
    root.querySelectorAll?.(".word-card .caution").forEach(element => element.remove());
  }

  function refreshUi() {
    patchLearningModes();
    patchUsageSpeedRecall();
    removeVerboseRiskDetails();
  }

  injectStyles();
  refreshUi();

  document.addEventListener("change", rememberSelectedMode);
  document.getElementById("startSelectedMode")?.addEventListener("click", setUsageSpeedFlag, true);

  const observer = new MutationObserver(() => refreshUi());
  observer.observe(document.body, { childList: true, subtree: true });
})();
