"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sandbox = {
  Blob,
  Date,
  JSON,
  Map,
  Math,
  Number,
  Object,
  Set,
  String,
  TextEncoder,
  console
};
sandbox.window = sandbox;
const context = vm.createContext(sandbox);
["js/storage.js", "js/content.js", "js/test.js"].forEach(file => {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
});
const { MWStorage: storage, MWContent: content, MWTest: test } = sandbox;
const tests = [];
const it = (name, fn) => tests.push({ name, fn });
const day = value => new Date(`${value}T12:00:00.000Z`).getTime();
const seeded = seed => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};
const words = (count, extra = () => ({})) => Array.from({ length: count }, (_, index) => ({
  id: `w${index}`,
  word: `word${index}`,
  normalized: `word${index}`,
  meaningsJa: [`意味${index}`],
  partOfSpeech: index % 2 ? "noun" : "verb",
  ...extra(index)
}));
const secureWord = (id = "secure") => ({ id, word: id, meaningsJa: [id], testStats: {}, spellingStats: {} });
const addSecureEvidence = (word, start = "2026-08-18") => {
  ["enToJa", "jaToEn"].forEach(direction => {
    test.applyDirectionAttempt(word, direction, { correct: true, responseMs: 1800 }, day(start));
    test.applyDirectionAttempt(word, direction, { correct: true, responseMs: 1800 }, day("2026-08-19"));
  });
  test.applySpellingAttempt(word, { correct: true, answer: word.word }, day(start));
  test.applySpellingAttempt(word, { correct: true, answer: word.word }, day("2026-08-19"));
  return word;
};
const readyDetail = word => test.readinessForRange({ words: [word] }, day("2026-08-20"));

it("runs all browser-module self-checks", () => {
  assert.equal(storage.runStorageSelfCheck().passed, true);
  assert.equal(content.runContentSelfCheck().passed, true);
  assert.equal(test.runTestFeatureSelfCheck().passed, true);
});

it("balances answer positions for empty through uneven small and normal sets", () => {
  [0, 1, 2, 3, 14, 15, 16].forEach(count => {
    [1, 7, 99].forEach(seed => {
      const positions = test.buildAnswerPositions(count, seeded(seed));
      assert.equal(positions.length, count);
      assert.ok(positions.every(position => position >= 0 && position < 4));
      const tally = [0, 0, 0, 0];
      positions.forEach(position => tally[position]++);
      assert.ok(Math.max(...tally) - Math.min(...tally) <= 1, `${count}: ${tally}`);
      positions.forEach((position, index) => {
        assert.notEqual(index > 1 && position === positions[index - 1] && position === positions[index - 2], true);
      });
    });
  });
});

it("keeps questions deterministic, balanced, and without category triples", () => {
  const pool = words(20, index => ({
    studyStatus: index < 6 ? "hard" : "unrated",
    testStats: index < 3 ? { enToJa: { lastResult: "incorrect" } } : {}
  }));
  const range = { id: "r", words: pool };
  const one = test.createTestSession(range, "enToJa", seeded(41));
  const two = test.createTestSession(range, "enToJa", seeded(41));
  assert.equal(one.error, undefined);
  assert.deepEqual(one.questions, two.questions);
  assert.equal(one.questions.length, 15);
  one.questions.forEach((question, index) => {
    assert.equal(question.choices.length, 4);
    assert.equal(new Set(question.choices.map(choice => choice.wordId)).size, 4);
    assert.equal(question.choices[question.correctPosition].wordId, question.wordId);
    assert.notEqual(index > 1 && question.category === one.questions[index - 1].category && question.category === one.questions[index - 2].category, true);
  });
});

it("limits wrong mode to the requested direction and supports one to three items", () => {
  [1, 2, 3].forEach(count => {
    const pool = words(7, index => ({ testStats: { enToJa: { lastResult: index < count ? "incorrect" : "correct" }, jaToEn: { lastResult: index === 6 ? "incorrect" : "correct" } } }));
    const session = test.createTestSession({ id: "wrong", words: pool }, "enToJa", { mode: "wrong" }, seeded(count));
    assert.equal(session.questions.length, count);
    assert.ok(session.questions.every(question => Number(question.wordId.slice(1)) < count));
    assert.ok(session.questions.every(question => question.category === "wrong"));
  });
  const noMatchingDirection = test.createTestSession({ id: "wrong", words: words(5, index => ({ testStats: { jaToEn: { lastResult: "incorrect" } } })) }, "enToJa", { mode: "wrong" });
  assert.ok(noMatchingDirection.error.includes("間違い集中"));
});

it("rejects malformed or too-small choice pools and produces unique choices for both directions", () => {
  const pool = words(8);
  ["enToJa", "jaToEn"].forEach(direction => {
    const choices = test.buildChoices(pool[0], pool, direction, 2, seeded(4));
    assert.equal(choices.length, 4);
    assert.equal(choices[2].wordId, pool[0].id);
    assert.equal(new Set(choices.map(choice => choice.wordId)).size, 4);
  });
  assert.equal(test.buildChoices(pool[0], pool.slice(0, 3), "enToJa"), null);
  assert.equal(test.buildChoices({ id: "same", word: "a", meaningsJa: ["同じ"] }, [
    { id: "same", word: "a", meaningsJa: ["同じ"] },
    { id: "b", word: "b", meaningsJa: ["同じ"] },
    { id: "c", word: "c", meaningsJa: ["同じ"] },
    { id: "d", word: "d", meaningsJa: ["同じ"] }
  ], "enToJa"), null);
});

it("enforces spelling case policy, exactness, typography normalization, and accepted forms", () => {
  const word = { id: "spell", word: "co-operate", acceptedSpellings: ["cooperate"], acceptedForms: ["co‑operate"], meaningsJa: ["協力"] };
  assert.equal(test.evaluateSpellingAnswer(word, "COOPERATE").correct, true);
  assert.equal(test.evaluateSpellingAnswer(word, " co—operate ").correct, true);
  assert.equal(test.evaluateSpellingAnswer(word, "co operate").correct, false);
  assert.equal(test.evaluateSpellingAnswer(word, "cooperate!").correct, false);
  assert.equal(test.evaluateSpellingAnswer(word, "cooperrate").correct, false);
  assert.equal(test.evaluateSpellingAnswer(word, "").correct, false);
});

it("requires distinct review dates, blocks same-day lapse recovery, and permits later recovery", () => {
  const word = secureWord("lapse");
  ["enToJa", "jaToEn"].forEach(direction => {
    test.applyDirectionAttempt(word, direction, { correct: true, responseMs: 1800 }, day("2026-08-18"));
    test.applyDirectionAttempt(word, direction, { correct: true, responseMs: 1800 }, day("2026-08-18") + 1000);
  });
  test.applySpellingAttempt(word, { correct: true, answer: word.word }, day("2026-08-18"));
  test.applySpellingAttempt(word, { correct: true, answer: word.word }, day("2026-08-18") + 1000);
  assert.equal(readyDetail(word).ready, false);
  addSecureEvidence(word);
  assert.equal(readyDetail(word).ready, true);
  test.applySpellingAttempt(word, { correct: false, answer: "lapsee" }, day("2026-08-20"));
  test.applySpellingAttempt(word, { correct: true, answer: word.word }, day("2026-08-20") + 1000);
  assert.equal(readyDetail(word).ready, false);
  test.applySpellingAttempt(word, { correct: true, answer: word.word }, day("2026-08-21"));
  assert.equal(test.readinessForRange({ words: [word] }, day("2026-08-21")).ready, true);
  const stale = addSecureEvidence(secureWord("stale"));
  const staleReadiness = test.readinessForRange({ words: [stale] }, day("2026-09-05"));
  assert.equal(staleReadiness.ready, false);
  assert.ok(staleReadiness.riskItems[0].reasons.some(reason => reason.includes("14日超")));
  const otherDirectionWeak = addSecureEvidence(secureWord("direction"));
  test.applyDirectionAttempt(otherDirectionWeak, "jaToEn", { correct: false, responseMs: 1800, selectedWordId: "x" }, day("2026-08-20"));
  assert.equal(test.selectTestReadyItems([otherDirectionWeak], "enToJa", 15, day("2026-08-20")).length, 0);
  assert.equal(test.selectTestReadyItems([otherDirectionWeak], "jaToEn", 15, day("2026-08-20")).length, 1);
});

it("requires recovery from slow, hesitant, and confusion risk when supported", () => {
  const slow = addSecureEvidence(secureWord("slow"));
  test.applyDirectionAttempt(slow, "enToJa", { correct: true, responseMs: 9000 }, day("2026-08-20"));
  assert.equal(readyDetail(slow).ready, false);
  test.applyDirectionAttempt(slow, "enToJa", { correct: true, responseMs: 1800 }, day("2026-08-21"));
  assert.equal(test.readinessForRange({ words: [slow] }, day("2026-08-21")).ready, true);
  const hesitant = addSecureEvidence(secureWord("hesitant"));
  test.applyDirectionAttempt(hesitant, "jaToEn", { correct: true, responseMs: 4500 }, day("2026-08-20"));
  assert.equal(readyDetail(hesitant).ready, false);
  test.applyDirectionAttempt(hesitant, "jaToEn", { correct: true, responseMs: 1800 }, day("2026-08-21"));
  assert.equal(test.readinessForRange({ words: [hesitant] }, day("2026-08-21")).ready, true);
  const confused = addSecureEvidence(secureWord("confused"));
  [1, 2].forEach(index => test.applyDirectionAttempt(confused, "enToJa", { correct: false, responseMs: 1800, selectedWordId: "distractor" }, day(`2026-08-2${index}`)));
  assert.equal(test.readinessForRange({ words: [confused] }, day("2026-08-22")).ready, false);
  test.applyDirectionAttempt(confused, "enToJa", { correct: true, responseMs: 1800 }, day("2026-08-23"));
  assert.equal(test.readinessForRange({ words: [confused] }, day("2026-08-23")).ready, true, "a later successful review clears lapse-backed confusion risk");
});

it("reports speed-review risk shape and keeps speed review isolated from recall stats", () => {
  const word = addSecureEvidence(secureWord("speed"));
  word.speedStats = { enToJa: { lastRating: "unsure", successfulReviewDates: ["2026-08-18", "2026-08-19"] } };
  const risk = readyDetail(word);
  assert.equal(risk.ready, false);
  assert.ok(risk.riskItems[0].reasons.some(reason => reason.includes("高速周回")));
  const items = [{ id: "a" }];
  const session = content.createRecallSession(items, { mode: "all", source: "usage" }, seeded(1), day("2026-08-18"));
  content.rateRecallItem(session, items[0], "cross", day("2026-08-18") + 1000);
  assert.equal(items[0].recallStats.lastLapseDate, "2026-08-18");
  assert.equal(Boolean(items[0].speedStats), false);
  const pool = words(20);
  pool[17].speedStats = { enToJa: { lastRating: "unsure", lastLapseAt: "2026-08-20T12:00:00.000Z", successfulReviewDates: [] } };
  const prioritized = test.selectTestWords(pool, "enToJa", 15, seeded(4), "normal");
  assert.equal(prioritized.find(item => item.word.id === "w17")?.category, "urgent");
  assert.equal(pool[17].studyStatus, undefined, "speed risk does not require or mutate the manual hard flag");
});

it("preserves recall lapse semantics across same-day retry and later-day recovery", () => {
  const item = { id: "recall" };
  const first = content.createRecallSession([item], { mode: "all", source: "usage" }, seeded(1), day("2026-08-18"));
  content.rateRecallItem(first, item, "circle", day("2026-08-18") + 1000);
  const second = content.createRecallSession([item], { mode: "all", source: "usage" }, seeded(1), day("2026-08-19"));
  content.rateRecallItem(second, item, "circle", day("2026-08-19") + 1000);
  assert.equal(content.isSettled(item), true);
  const lapse = content.createRecallSession([item], { mode: "all", source: "usage" }, seeded(1), day("2026-08-20"));
  content.rateRecallItem(lapse, item, "cross", day("2026-08-20") + 1000);
  content.rateRecallItem(lapse, item, "circle", day("2026-08-20") + 2000);
  assert.equal(content.isSettled(item), false);
  const recover = content.createRecallSession([item], { mode: "all", source: "usage" }, seeded(1), day("2026-08-21"));
  content.rateRecallItem(recover, item, "circle", day("2026-08-21") + 1000);
  assert.equal(content.isSettled(item), true);
});

it("uses existing recall history while keeping usage tests one-pass and finish reviews retryable", () => {
  const testItems = [{ id: "example" }, { id: "phrase" }];
  const testSession = content.createRecallSession(testItems, { mode: "test15", source: "usage", purpose: "test" }, seeded(1), day("2026-08-18"));
  const firstTestItem = testItems.find(item => item.id === testSession.queue[0]);
  content.rateRecallItem(testSession, firstTestItem, "cross", day("2026-08-18") + 1000);
  assert.equal(testSession.queue.includes(firstTestItem.id), false, "a confirmation test asks each item once");
  const secondTestItem = testItems.find(item => item.id === testSession.queue[0]);
  content.rateRecallItem(testSession, secondTestItem, "triangle", day("2026-08-18") + 2000);
  assert.equal(testSession.finished, true);
  assert.equal(firstTestItem.recallStats.lastRating, "cross", "the existing recall history records test results");

  const finishItem = { id: "finish" };
  const finishSession = content.createRecallSession([finishItem], { mode: "unsettled", source: "usage", purpose: "finish" }, seeded(2), day("2026-08-19"));
  content.rateRecallItem(finishSession, finishItem, "cross", day("2026-08-19") + 1000);
  assert.equal(finishSession.finished, false);
  assert.equal(finishSession.queue.includes(finishItem.id), true, "finish review requeues an item that was not recalled");
  content.rateRecallItem(finishSession, finishItem, "circle", day("2026-08-19") + 2000);
  assert.equal(finishSession.finished, true);
});

it("sanitizes malformed storage, future schemas, IDs and references, and round-trips allowed data only", () => {
  assert.equal(storage.parseBackup(null).ok, false);
  assert.equal(storage.parseBackup("{").ok, false);
  assert.equal(storage.migrateBackup({ schemaVersion: storage.SCHEMA_VERSION + 1, ranges: [] }).ok, false);
  const original = {
    schemaVersion: 1,
    settings: { saveKey: true, dictionaryType: "collegiate", playbackInterval: 3, usageReviewExtraSeconds: 10 },
    studyLog: { "2026-08-20": { attempts: 4, correct: 9, enToJa: { attempts: 3, correct: 9 } }, bad: { attempts: 9 } },
    ui: { selectedRangeId: "bad range" },
    ranges: [{ id: "bad range", rangeName: "A", testDate: "2026-08-22", words: [
      { id: "same id", word: "record", syllabifiedHeadword: "rec*ord", meaningsJa: ["記録"], mwUrl: "javascript:alert(1)", audioUrl: "data:audio/mp3,bad", pronunciationVariants: [{ id: "bad id", syllabifiedHeadword: "rec*ord", audioUrl: "javascript:alert(1)" }, { id: "bad id" }], testStats: { enToJa: { confusedWith: { "same id": 2, missing: 4 } } } },
      { id: "same id", word: "expense", meaningsJa: ["費用"] }
    ], usageItems: [{ id: "usage id", type: "example", english: "Keep a record.", japanese: "記録をつける。", linkedWordIds: ["same id", "missing"] }], testHistory: [{ wrongWordIds: ["same id", "missing"], total: 2, correct: 9 }] }]
  };
  const migrated = storage.migrateBackup(original);
  assert.equal(migrated.ok, true);
  const range = migrated.data.ranges[0];
  assert.equal(range.id, "bad_range");
  assert.notEqual(range.words[0].id, range.words[1].id);
  assert.equal(JSON.stringify(range.usageItems[0].linkedWordIds), JSON.stringify([range.words[0].id]));
  assert.equal(JSON.stringify(range.testHistory[0].wrongWordIds), JSON.stringify([range.words[0].id]));
  assert.equal(range.words[0].pronunciationVariants[0].id, "bad_id");
  assert.notEqual(range.words[0].pronunciationVariants[0].id, range.words[0].pronunciationVariants[1].id);
  assert.equal(range.words[0].mwUrl, "");
  assert.equal(range.words[0].audioUrl, "");
  assert.equal(range.words[0].pronunciationVariants[0].audioUrl, "");
  assert.equal(range.words[0].syllabifiedHeadword, "rec*ord");
  assert.equal(range.words[0].pronunciationVariants[0].syllabifiedHeadword, "rec*ord");
  assert.equal(migrated.data.ui.selectedRangeId, range.id, "renamed range references are migrated");
  assert.equal(migrated.data.studyLog["2026-08-20"].correct, 4);
  assert.equal(migrated.data.settings.usageReviewExtraSeconds, 10);
  const backup = storage.createBackup({ ...migrated.data, ui: { selectedRangeId: range.id }, settings: { ...migrated.data.settings, saveKey: true, apiKeySession: "secret" } }, "2026-08-20T00:00:00.000Z");
  assert.equal(JSON.stringify(backup).includes("secret"), false);
  const imported = storage.planImport(JSON.stringify(backup), [], "append");
  assert.equal(imported.ok, true);
  assert.equal(imported.data.settings.saveKey, false);
  assert.equal(imported.data.settings.usageReviewExtraSeconds, 10);
  assert.equal(JSON.stringify(imported.data.studyLog), JSON.stringify(backup.studyLog));
  assert.equal(storage.migrateBackup({ ranges: [{ id: "broken", words: [], usageItems: [{ id: "u", english: "", japanese: "欠落" }] }] }).ok, false);
  assert.equal(JSON.stringify(imported.data.ui), JSON.stringify(backup.ui));
  const globalIds = storage.migrateBackup({ ranges: [
    { id: "r1", rangeName: "R1", words: [{ id: "shared", word: "one", meaningsJa: ["一"] }] },
    { id: "r2", rangeName: "R2", words: [{ id: "shared", word: "two", meaningsJa: ["二"] }] }
  ] });
  assert.equal(globalIds.ok, true);
  assert.notEqual(globalIds.data.ranges[0].words[0].id, globalIds.data.ranges[1].words[0].id);
  const conflicting = storage.planImport(JSON.stringify({ schemaVersion: 3, ranges: [
    { id: range.id, rangeName: range.rangeName, testDate: range.testDate, words: [{ id: "new", word: "changed", meaningsJa: ["変更"] }] }
  ] }), backup.ranges, "append");
  assert.equal(conflicting.ok, false);
  assert.ok(conflicting.errors[0].includes("内容が異なり"));
});

let failed = 0;
tests.forEach(({ name, fn }) => {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error.stack}`);
  }
});
console.log(`${tests.length - failed}/${tests.length} tests passed`);
process.exitCode = failed ? 1 : 0;

