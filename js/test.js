
const DIRECTIONS = ["enToJa", "jaToEn"];
const READY_EVIDENCE_MAX_AGE_DAYS = 14;

const shuffle = (items, random = Math.random) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const meanings = word => (Array.isArray(word.meaningsJa) ? word.meaningsJa : []).map(v => String(v).trim()).filter(Boolean);
const statFor = (word, direction) => word.testStats?.[direction] || {};
const meaningKey = word => meanings(word).map(v => v.toLocaleLowerCase("ja")).sort().join("|");
const sharesMeaning = (a, b) => meanings(a).some(value => meanings(b).includes(value));
const accuracy = stat => stat.attempts ? stat.correct / stat.attempts : -1;
const asCount = value => Math.max(0, Math.floor(Number(value) || 0));
const localDateKey = value => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};
const hasLaterLocalDate = (dates, lapseAt) => {
  const lapseDay = localDateKey(lapseAt);
  return !lapseDay || dates.some(date => String(date) > lapseDay);
};
const hasRecentLocalDate = (dates, now = Date.now(), maxAgeDays = READY_EVIDENCE_MAX_AGE_DAYS) => {
  const latest = [...dates].sort().at(-1);
  const today = localDateKey(now);
  if (!latest || !today) return false;
  const latestAt = new Date(`${latest}T12:00:00`).getTime();
  const todayAt = new Date(`${today}T12:00:00`).getTime();
  const ageDays = Math.round((todayAt - latestAt) / 86400000);
  return ageDays >= 0 && ageDays <= maxAgeDays;
};
const hasUnresolvedSpeedRisk = (word, direction) => {
  const speed = word?.speedStats?.[direction] || word?.speedStats;
  if (!speed || typeof speed !== "object") return false;
  const lastRating = speed.lastRating || speed.lastResult || "";
  const successfulDates = [...new Set([...(Array.isArray(speed.successfulReviewDates) ? speed.successfulReviewDates : []), ...(Array.isArray(speed.instantReviewDates) ? speed.instantReviewDates : [])]
    .map(date => /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : localDateKey(date)).filter(Boolean))];
  return ["unknown", "unsure", "incorrect"].includes(lastRating) || Boolean(speed.lastLapseAt && !hasLaterLocalDate(successfulDates, speed.lastLapseAt));
};

function defaultDirectionStats() {
  return {
    attempts: 0,
    correct: 0,
    incorrect: 0,
    consecutiveCorrect: 0,
    lastResult: "",
    lastTestedAt: "",
    totalResponseMs: 0,
    recentResponseMs: [],
    slowCount: 0,
    hesitantCount: 0,
    lastTiming: "",
    successfulReviewDates: [],
    lastLapseAt: "",
    lastConfusionAt: "",
    confusedWith: {}
  };
}

function normalizeDirectionStats(value) {
  const source = value && typeof value === "object" ? value : {};
  const dates = [...new Set([...(Array.isArray(source.successfulReviewDates) ? source.successfulReviewDates : []), ...(Array.isArray(source.successfulDates) ? source.successfulDates : [])]
    .map(date => /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : localDateKey(date))
    .filter(Boolean))].sort();
  const responses = (Array.isArray(source.recentResponseMs) ? source.recentResponseMs : [])
    .map(valueAt => Math.max(0, Math.min(300000, Number(valueAt) || 0))).filter(valueAt => valueAt > 0).slice(-12);
  const confusedWith = Object.fromEntries(Object.entries(source.confusedWith && typeof source.confusedWith === "object" ? source.confusedWith : {})
    .filter(([id, count]) => id && asCount(count)).map(([id, count]) => [id, asCount(count)]));
  const attempts = asCount(source.attempts);
  const correct = Math.min(attempts, asCount(source.correct));
  const incorrect = Math.max(asCount(source.incorrect), attempts - correct);
  return {
    ...defaultDirectionStats(),
    attempts,
    correct,
    incorrect,
    consecutiveCorrect: Math.min(correct, asCount(source.consecutiveCorrect)),
    lastResult: ["correct", "incorrect"].includes(source.lastResult) ? source.lastResult : "",
    lastTestedAt: typeof source.lastTestedAt === "string" ? source.lastTestedAt : "",
    totalResponseMs: asCount(source.totalResponseMs),
    recentResponseMs: responses,
    slowCount: asCount(source.slowCount),
    hesitantCount: asCount(source.hesitantCount),
    lastTiming: ["fast", "hesitant", "slow"].includes(source.lastTiming) ? source.lastTiming : "",
    successfulReviewDates: dates,
    lastLapseAt: typeof source.lastLapseAt === "string" ? source.lastLapseAt : "",
    lastConfusionAt: typeof source.lastConfusionAt === "string" ? source.lastConfusionAt : "",
    confusedWith
  };
}

function applyDirectionAttempt(word, direction, answer, now = Date.now()) {
  if (!word || !DIRECTIONS.includes(direction) || !answer || typeof answer !== "object") return null;
  word.testStats = word.testStats && typeof word.testStats === "object" ? word.testStats : {};
  const stats = normalizeDirectionStats(word.testStats[direction]);
  const responseMs = Math.max(0, Math.min(300000, Number(answer.responseMs) || 0));
  const priorMedian = median(stats.recentResponseMs);
  const directionBaseline = direction === "jaToEn" ? 6000 : 4500;
  const adaptiveThreshold = Math.max(directionBaseline, priorMedian ? Math.round(priorMedian * 1.35) : 0);
  const slow = responseMs > adaptiveThreshold;
  const hesitant = !slow && responseMs >= Math.round(adaptiveThreshold * 0.65);
  const timestamp = new Date(now).toISOString();
  stats.attempts++;
  stats.totalResponseMs += responseMs;
  stats.recentResponseMs = [...stats.recentResponseMs, responseMs].slice(-12);
  stats.lastTestedAt = timestamp;
  stats.lastResult = answer.correct ? "correct" : "incorrect";
  stats.lastTiming = slow ? "slow" : hesitant ? "hesitant" : "fast";
  if (answer.correct) {
    stats.correct++;
    stats.consecutiveCorrect++;
    const day = localDateKey(now);
    if (!slow && !hesitant && day && !stats.successfulReviewDates.includes(day)) stats.successfulReviewDates.push(day);
    stats.successfulReviewDates.sort();
  } else {
    stats.incorrect++;
    stats.consecutiveCorrect = 0;
    stats.lastLapseAt = timestamp;
    if (answer.selectedWordId) {
      stats.confusedWith[answer.selectedWordId] = (stats.confusedWith[answer.selectedWordId] || 0) + 1;
      stats.lastConfusionAt = timestamp;
    }
  }
  if (slow) stats.slowCount++;
  if (hesitant) stats.hesitantCount++;
  word.testStats[direction] = stats;
  return { stats, slow, hesitant };
}

function deterministicRank(items, score, random = Math.random) {
  return items.map(item => ({ item, score: Number(score(item)) || 0, randomKey: Number(random()) || 0 }))
    .sort((a, b) => b.score - a.score || a.randomKey - b.randomKey || String(a.item.id || "").localeCompare(String(b.item.id || "")))
    .map(entry => entry.item);
}

function analyzeSpellingRisk(value) {
  const word = String(value || "").toLowerCase().trim();
  const reasons = [];
  let score = 0;
  const add = (reason, weight = 1) => {
    if (!reasons.includes(reason)) reasons.push(reason);
    score += weight;
  };
  const doubleGroups = word.match(/([a-z])\1/g) || [];
  if (doubleGroups.length >= 2) add("二重文字が複数", 4);
  else if (doubleGroups.length === 1) add("二重文字", 2);
  if (/(cial|tial)$/.test(word)) add("語尾 -cial / -tial", 2);
  else if (/(tion|sion|cian)$/.test(word)) add("語尾 -tion / -sion", 2);
  else if (/(ance|ence|ant|ent)$/.test(word)) add("紛らわしい語尾", 2);
  else if (/(able|ible)$/.test(word)) add("語尾 -able / -ible", 2);
  else if (/(ary|ery|ory)$/.test(word)) add("語尾 -ary / -ery / -ory", 2);
  if (/(ie|ei)/.test(word)) add("ie / ei の並び");
  if (/(ough|eigh)/.test(word)) add("不規則な母音綴り", 3);
  else if (/(gh|kn|wr|mb|mn$|bt$|ps|rh)/.test(word)) add("発音と綴りのずれ", 2);
  if (/[-']/.test(word)) add("記号の位置");
  if (word.length >= 10 && reasons.length) score++;
  if (word.length >= 12) add("長い綴り");
  return {
    level: score >= 4 ? "high" : score >= 1 ? "medium" : "low",
    score,
    reasons: reasons.slice(0, 2)
  };
}

function createSpeedReviewSession(range, wordIds = null, now = Date.now()) {
  const available = new Set((range.words || []).filter(word => word.word).map(word => word.id));
  const selected = [...new Set((Array.isArray(wordIds) ? wordIds : [...available]).filter(id => available.has(id)))];
  if (!selected.length) return { error: "高速周回できる単語がありません。" };
  return {
    id: `speed_${now.toString(36)}`,
    rangeId: range.id,
    round: 1,
    allWordIds: selected,
    roundWordIds: selected,
    roundStartCount: selected.length,
    repeatWordIds: [],
    index: 0,
    assessments: [],
    completedRounds: [],
    startedAtMs: now,
    wordStartedAtMs: now,
    finished: false
  };
}

function restartSpeedReviewSession(session, now = Date.now()) {
  if (!session?.finished || !Array.isArray(session.allWordIds) || !session.allWordIds.length) return false;
  session.round++;
  session.roundWordIds = [...session.allWordIds];
  session.roundStartCount = session.roundWordIds.length;
  session.repeatWordIds = [];
  session.index = 0;
  session.wordStartedAtMs = now;
  session.finished = false;
  delete session.finishedAtMs;
  return true;
}

function rateSpeedReviewWord(session, rating, now = Date.now()) {
  if (!session || session.finished || !["unknown", "unsure", "instant"].includes(rating)) return null;
  const wordId = session.roundWordIds[session.index];
  if (!wordId) return null;
  const assessment = {
    wordId,
    rating,
    round: session.round,
    responseMs: Math.max(0, Math.min(300000, now - session.wordStartedAtMs))
  };
  session.assessments.push(assessment);
  if (rating !== "instant" && !session.repeatWordIds.includes(wordId)) session.repeatWordIds.push(wordId);
  session.index++;
  if (session.index < session.roundWordIds.length) {
    session.wordStartedAtMs = now;
    return { assessment, roundComplete: false, finished: false };
  }
  const roundAssessments = session.assessments.filter(item => item.round === session.round);
  session.completedRounds.push({
    round: session.round,
    total: session.roundStartCount,
    unknown: roundAssessments.filter(item => item.rating === "unknown").length,
    unsure: roundAssessments.filter(item => item.rating === "unsure").length,
    instant: roundAssessments.filter(item => item.rating === "instant").length
  });
  if (!session.repeatWordIds.length) {
    session.finished = true;
    session.finishedAtMs = now;
    return { assessment, roundComplete: true, finished: true };
  }
  session.round++;
  session.roundWordIds = [...session.repeatWordIds];
  session.roundStartCount = session.roundWordIds.length;
  session.repeatWordIds = [];
  session.index = 0;
  session.wordStartedAtMs = now;
  return { assessment, roundComplete: true, finished: false };
}

function selectTestWords(words, direction, limit = 15, random = Math.random, mode = "normal") {
  const eligible = words.filter(word => word.word && meanings(word).length);
  const canBuild = eligible.filter(word => buildChoices(word, eligible, direction, 0, random));
  const urgent = canBuild.filter(word => word.studyStatus === "hard" || statFor(word, direction).lastResult === "incorrect" || hasUnresolvedSpeedRisk(word, direction));
  const untested = canBuild.filter(word => !statFor(word, direction).attempts && !urgent.includes(word));
  const normal = canBuild.filter(word => !urgent.includes(word) && !untested.includes(word));
  const sortReview = list => deterministicRank(list, word => {
    const sa = statFor(word, direction);
    return (1 - accuracy(sa)) * 100 + Math.max(0, 8 - (sa.consecutiveCorrect || 0)) * 5 +
      Math.max(0, 6 - (sa.attempts || 0)) + (sa.lastResult === "incorrect" ? 30 : 0) + (hasUnresolvedSpeedRisk(word, direction) ? 25 : 0);
  }, random);
  if (mode === "wrong") {
    return sortReview(canBuild.filter(word => statFor(word, direction).lastResult === "incorrect"))
      .slice(0, Math.min(15, Math.max(1, limit))).map(word => ({ word, category: "wrong" }));
  }
  const chosen = [];
  const take = (list, count, category) => sortReview(list).slice(0, count).forEach(word => chosen.push({ word, category }));
  take(urgent, Math.min(6, limit), "urgent");
  take(untested, Math.min(6, limit - chosen.length), "untested");
  take(normal, limit - chosen.length, "normal");
  if (chosen.length < limit) {
    const used = new Set(chosen.map(item => item.word.id));
    take(canBuild.filter(word => !used.has(word.id)), limit - chosen.length, "normal");
  }
  return chosen;
}

function buildChoices(correct, pool, direction, correctPosition = 0, random = Math.random) {
  const candidates = pool.filter(word => word.id !== correct.id && word.word && meanings(word).length && !sharesMeaning(correct, word));
  const confusedIds = Object.entries(statFor(correct, direction).confusedWith || {}).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const score = word => {
    let value = Math.max(0, 100 - (confusedIds.indexOf(word.id) + 1) * 10) * Number(confusedIds.includes(word.id));
    if (word.partOfSpeech && word.partOfSpeech === correct.partOfSpeech) value += 30;
    if (direction === "enToJa") value += Math.max(0, 20 - Math.abs(meanings(word).join("／").length - meanings(correct).join("／").length));
    else {
      const a = word.normalized || word.word.toLowerCase(), b = correct.normalized || correct.word.toLowerCase();
      if (a[0] === b[0]) value += 12;
      value += Math.max(0, 12 - Math.abs(a.length - b.length));
    }
    return value;
  };
  const unique = [];
  const seen = new Set();
  deterministicRank(candidates, score, random).forEach(word => {
    const key = direction === "enToJa" ? meaningKey(word) : String(word.normalized || word.word).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(word);
  });
  if (unique.length < 3) return null;
  let distractors = unique.slice(0, 3);
  if (direction === "jaToEn" && distractors.every(word => (word.word[0] || "").toLowerCase() === (correct.word[0] || "").toLowerCase())) {
    const other = unique.find(word => (word.word[0] || "").toLowerCase() !== (correct.word[0] || "").toLowerCase());
    if (other) distractors[2] = other;
  }
  const choices = distractors.map(word => ({ wordId: word.id, label: direction === "enToJa" ? meanings(word).join("／") : word.word }));
  choices.splice(correctPosition, 0, { wordId: correct.id, label: direction === "enToJa" ? meanings(correct).join("／") : correct.word });
  return choices;
}

function buildAnswerPositions(count = 15, random = Math.random) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (!total) return [];
  const base = Math.floor(total / 4), remainder = total % 4;
  const extraOrder = shuffle([0, 1, 2, 3], random);
  const remaining = [0, 1, 2, 3].map(position => base + Number(extraOrder.slice(0, remainder).includes(position)));
  const result = [];
  while (result.length < total) {
    const blocked = result.length > 1 && result.at(-1) === result.at(-2) ? result.at(-1) : -1;
    const candidates = [0, 1, 2, 3].filter(position => position !== blocked && remaining[position] > 0);
    const maxRemaining = Math.max(...candidates.map(position => remaining[position]));
    const tied = candidates.filter(position => remaining[position] === maxRemaining);
    const position = tied[Math.min(tied.length - 1, Math.floor((Number(random()) || 0) * tied.length))];
    result.push(position);
    remaining[position]--;
  }
  return result;
}

function buildQuestionOrder(selected, random = Math.random) {
  const groups = {};
  selected.forEach(item => { (groups[item.category] ||= []).push(item); });
  Object.keys(groups).forEach(key => { groups[key] = shuffle(groups[key], random); });
  const result = [];
  while (result.length < selected.length) {
    const lastTwo = result.slice(-2).map(item => item.category);
    const choices = Object.keys(groups).filter(key => groups[key].length && !(lastTwo.length === 2 && lastTwo.every(v => v === key)));
    const key = choices.sort((a, b) => groups[b].length - groups[a].length)[0] || Object.keys(groups).find(k => groups[k].length);
    result.push(groups[key].shift());
  }
  return result;
}

function createTestSession(range, direction, options = {}, legacyRandom = Math.random) {
  if (!DIRECTIONS.includes(direction)) throw new Error("Invalid direction");
  // Old callers passed a random function as the third argument. Keep that API working.
  const random = typeof options === "function" ? options : (typeof legacyRandom === "function" ? legacyRandom : Math.random);
  const mode = typeof options === "object" && ["normal", "wrong", "ready"].includes(options.mode) ? options.mode : "normal";
  const words = range.words || [];
  const requestedIds = typeof options === "object" && Array.isArray(options.wordIds) ? new Set(options.wordIds) : null;
  const buildable = words.filter(word => word.word && meanings(word).length && buildChoices(word, words, direction, 0, random));
  let selected;
  if (requestedIds) {
    selected = buildable.filter(word => requestedIds.has(word.id)).slice(0, 15).map(word => ({ word, category: mode === "ready" ? "ready" : mode }));
  } else if (mode === "ready") {
    selected = selectTestReadyItems(buildable, direction, 15).map(word => ({ word, category: "ready" }));
  } else {
    selected = selectTestWords(words, direction, 15, random, mode);
  }
  if (!selected.length) return { error: mode === "wrong" ? "現在、間違い集中モードの対象単語はありません。" : "出題できる単語がありません。" };
  if (selected.length < 15 && mode === "normal") return { error: "日本語訳と有効な選択肢がある単語が15語必要です。" };
  const order = buildQuestionOrder(selected, random);
  const positions = buildAnswerPositions(selected.length, random);
  const questions = order.map((item, index) => ({
    wordId: item.word.id,
    category: item.category,
    correctPosition: positions[index],
    choices: buildChoices(item.word, range.words, direction, positions[index], random)
  }));
  if (questions.some(q => !q.choices)) return { error: "選択肢を作成できない単語があります。" };
  return { id: `test_${Date.now().toString(36)}`, rangeId: range.id, direction, mode, questions, index: 0, answers: [], startedAt: new Date().toISOString(), questionStartedAt: Date.now(), finished: false };
}

function normalizeSpellingStats(value) {
  const source = value && typeof value === "object" ? value : {};
  const attempts = asCount(source.attempts), correct = Math.min(attempts, asCount(source.correct));
  return {
    attempts,
    correct,
    incorrect: Math.max(asCount(source.incorrect), attempts - correct),
    consecutiveCorrect: Math.min(correct, asCount(source.consecutiveCorrect)),
    lastResult: ["correct", "incorrect"].includes(source.lastResult) ? source.lastResult : "",
    lastAttemptedAt: typeof source.lastAttemptedAt === "string" ? source.lastAttemptedAt : "",
    successfulReviewDates: [...new Set((Array.isArray(source.successfulReviewDates) ? source.successfulReviewDates : [])
      .map(date => /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : localDateKey(date)).filter(Boolean))].sort(),
    lastLapseAt: typeof source.lastLapseAt === "string" ? source.lastLapseAt : "",
    wrongAnswers: (Array.isArray(source.wrongAnswers) ? source.wrongAnswers : []).map(String).filter(Boolean).slice(-8)
  };
}

function normalizeSpellingTypography(value) {
  return String(value ?? "").normalize("NFKC").trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u2010-\u2015]/g, "-");
}

function explicitSpellingForms(word) {
  const fields = [word?.acceptedSpellings, word?.acceptedForms, word?.spellingForms];
  return [...new Set([word?.word, ...fields.flatMap(value => Array.isArray(value) ? value : [])]
    .map(normalizeSpellingTypography).filter(Boolean))];
}

function evaluateSpellingAnswer(word, answer) {
  const entered = normalizeSpellingTypography(answer);
  const acceptedForms = explicitSpellingForms(word);
  const correct = Boolean(entered) && acceptedForms.some(form => form.localeCompare(entered, undefined, { sensitivity: "accent" }) === 0);
  return { correct, answer: entered, acceptedForms, expected: acceptedForms[0] || "" };
}

function applySpellingAttempt(word, attempt, now = Date.now()) {
  if (!word || !attempt || typeof attempt !== "object") return null;
  const stats = normalizeSpellingStats(word.spellingStats);
  const correct = Boolean(attempt.correct);
  stats.attempts++;
  stats.lastResult = correct ? "correct" : "incorrect";
  stats.lastAttemptedAt = new Date(now).toISOString();
  if (correct) {
    stats.correct++;
    stats.consecutiveCorrect++;
    const day = localDateKey(now);
    if (day && !stats.successfulReviewDates.includes(day)) stats.successfulReviewDates.push(day);
    stats.successfulReviewDates.sort();
  } else {
    stats.incorrect++;
    stats.consecutiveCorrect = 0;
    stats.lastLapseAt = stats.lastAttemptedAt;
    const entered = normalizeSpellingTypography(attempt.answer);
    if (entered) stats.wrongAnswers = [...stats.wrongAnswers, entered].slice(-8);
  }
  word.spellingStats = stats;
  return stats;
}

function createSpellingSession(range, wordIds = null, now = Date.now()) {
  const allowed = new Set((range.words || []).filter(word => word.word).map(word => word.id));
  const ids = [...new Set((Array.isArray(wordIds) ? wordIds : [...allowed]).filter(id => allowed.has(id)))];
  if (!ids.length) return { error: "スペル練習できる単語がありません。" };
  return { id: `spelling_${Number(now).toString(36)}`, rangeId: range.id, wordIds: ids, index: 0, answers: [], startedAt: new Date(now).toISOString(), questionStartedAt: now, finished: false };
}

function answerSpellingQuestion(session, range, answer, now = Date.now()) {
  if (!session || session.finished || session.answers.some(item => item.questionIndex === session.index)) return null;
  const wordId = session.wordIds?.[session.index], word = (range.words || []).find(item => item.id === wordId);
  if (!word) return null;
  const evaluation = evaluateSpellingAnswer(word, answer);
  const attempt = { questionIndex: session.index, wordId, ...evaluation, responseMs: Math.max(0, Math.min(300000, Number(now) - Number(session.questionStartedAt || now))) };
  applySpellingAttempt(word, attempt, now);
  session.answers.push(attempt);
  session.index++;
  session.questionStartedAt = now;
  if (session.index >= session.wordIds.length) session.finished = true;
  return attempt;
}

function finishSpellingSession(session, range, now = Date.now()) {
  if (!session) return null;
  if (session.result) return session.result;
  session.finished = true;
  session.finishedAt = new Date(now).toISOString();
  const correct = (session.answers || []).filter(answer => answer.correct).length;
  const result = { id: session.id, total: session.wordIds?.length || 0, answered: session.answers?.length || 0, correct, incorrect: (session.answers?.length || 0) - correct, startedAt: session.startedAt, finishedAt: session.finishedAt };
  range.spellingHistory = [...(range.spellingHistory || []), result].slice(-30);
  session.result = result;
  return result;
}

function readinessForWord(word, now = Date.now()) {
  const reasons = [];
  let hasEvidence = false;
  DIRECTIONS.forEach(direction => {
    const stats = normalizeDirectionStats(statFor(word, direction));
    if (stats.attempts) hasEvidence = true;
    if (!stats.attempts) reasons.push(`${directionLabel(direction)}: 未確認`);
    if (stats.successfulReviewDates.length < 2) reasons.push(`${directionLabel(direction)}: 別日の成功確認が不足`);
    if (stats.successfulReviewDates.length && !hasRecentLocalDate(stats.successfulReviewDates, now)) reasons.push(`${directionLabel(direction)}: 最終確認が14日超`);
    if (stats.lastResult !== "correct") reasons.push(`${directionLabel(direction)}: 直近の誤答`);
    if (["slow", "hesitant"].includes(stats.lastTiming)) reasons.push(`${directionLabel(direction)}: ${stats.lastTiming === "slow" ? "遅い回答" : "ためらい"}`);
    if (stats.lastLapseAt && !hasLaterLocalDate(stats.successfulReviewDates, stats.lastLapseAt)) reasons.push(`${directionLabel(direction)}: 誤答後の別日確認が不足`);
    const repeatedConfusion = Object.values(stats.confusedWith).some(count => count >= 2);
    if (repeatedConfusion && (!stats.lastConfusionAt || !hasLaterLocalDate(stats.successfulReviewDates, stats.lastConfusionAt))) {
      reasons.push(`${directionLabel(direction)}: 選択肢の混同`);
    }
    const speed = word.speedStats?.[direction] || word.speedStats;
    if (speed && typeof speed === "object") {
      const lastRating = speed.lastRating || speed.lastResult || "";
      const successfulDates = [...new Set([...(Array.isArray(speed.successfulReviewDates) ? speed.successfulReviewDates : []), ...(Array.isArray(speed.instantReviewDates) ? speed.instantReviewDates : [])]
        .map(date => /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : localDateKey(date)).filter(Boolean))];
      if (lastRating || successfulDates.length || speed.lastLapseAt) hasEvidence = true;
      if (["unknown", "unsure", "incorrect"].includes(lastRating) || (speed.lastLapseAt && !hasLaterLocalDate(successfulDates, speed.lastLapseAt))) reasons.push(`${directionLabel(direction)}: 高速周回で不安`);
    }
  });
  const spelling = normalizeSpellingStats(word.spellingStats);
  if (spelling.attempts) hasEvidence = true;
  if (!spelling.attempts) reasons.push("スペル: 未確認");
  else {
    if (spelling.lastResult !== "correct") reasons.push("スペル: 直近の誤答");
    if (spelling.successfulReviewDates.length < 2) reasons.push("スペル: 別日の成功確認が不足");
    if (spelling.successfulReviewDates.length && !hasRecentLocalDate(spelling.successfulReviewDates, now)) reasons.push("スペル: 最終確認が14日超");
    if (spelling.lastLapseAt && !hasLaterLocalDate(spelling.successfulReviewDates, spelling.lastLapseAt)) reasons.push("スペル: 誤答後の別日確認が不足");
  }
  return { ready: reasons.length === 0, hasEvidence, reasons: [...new Set(reasons)] };
}

function wordsFrom(value) { return Array.isArray(value) ? value : (value?.words || []); }

function selectWeakItems(value, direction = null, limit = 15, now = Date.now()) {
  const selected = wordsFrom(value).filter(word => word?.word).map(word => ({ word, detail: readinessForWord(word, now) }))
    .filter(item => !item.detail.ready);
  return selected.sort((a, b) => {
    const aWrong = direction && statFor(a.word, direction).lastResult === "incorrect", bWrong = direction && statFor(b.word, direction).lastResult === "incorrect";
    return Number(bWrong) - Number(aWrong) || b.detail.reasons.length - a.detail.reasons.length || String(a.word.id).localeCompare(String(b.word.id));
  }).slice(0, limit).map(item => item.word);
}

function selectTestReadyItems(value, direction = null, limit = 15, now = Date.now()) {
  const label = direction ? `${directionLabel(direction)}:` : "";
  const candidates = wordsFrom(value).filter(word => word?.word && meanings(word).length).map(word => ({
    word,
    detail: readinessForWord(word, now)
  })).filter(item => !item.detail.ready && (!label || item.detail.reasons.some(reason => reason.startsWith(label))));
  return candidates.sort((a, b) => {
    const aStats = direction ? normalizeDirectionStats(statFor(a.word, direction)) : null;
    const bStats = direction ? normalizeDirectionStats(statFor(b.word, direction)) : null;
    const aWrong = aStats?.lastResult === "incorrect", bWrong = bStats?.lastResult === "incorrect";
    const aReasons = label ? a.detail.reasons.filter(reason => reason.startsWith(label)).length : a.detail.reasons.length;
    const bReasons = label ? b.detail.reasons.filter(reason => reason.startsWith(label)).length : b.detail.reasons.length;
    return Number(bWrong) - Number(aWrong) || bReasons - aReasons || String(a.word.id).localeCompare(String(b.word.id));
  }).slice(0, limit).map(item => item.word);
}

function readinessForRange(range, now = Date.now()) {
  const words = wordsFrom(range).filter(word => word?.word);
  const evaluations = words.map(word => ({ word, detail: readinessForWord(word, now) }));
  const riskItems = evaluations.filter(item => !item.detail.ready).map(item => ({ wordId: item.word.id, reasons: item.detail.reasons }));
  const evidence = evaluations.filter(item => item.detail.hasEvidence).length;
  const checks = [
    { key: "unverified", label: "未確認単語", count: evaluations.filter(item => !item.detail.hasEvidence).length },
    { key: "reviewDates", label: "別日の成功確認不足", count: riskItems.filter(item => item.reasons.some(reason => reason.includes("別日の成功確認"))).length },
    { key: "freshness", label: "14日以内の最終確認なし", count: riskItems.filter(item => item.reasons.some(reason => reason.includes("最終確認が14日超"))).length },
    { key: "wrong", label: "直近の誤答", count: riskItems.filter(item => item.reasons.some(reason => reason.includes("直近の誤答"))).length },
    { key: "slow", label: "遅い・ためらい回答", count: riskItems.filter(item => item.reasons.some(reason => reason.includes("遅い回答") || reason.includes("ためらい"))).length },
    { key: "confusion", label: "選択肢の混同", count: riskItems.filter(item => item.reasons.some(reason => reason.includes("混同"))).length },
    { key: "spelling", label: "スペル未定着", count: riskItems.filter(item => item.reasons.some(reason => reason.includes("スペル"))).length }
  ];
  const ready = words.length > 0 && riskItems.length === 0;
  return { status: !evidence ? "unverified" : ready ? "safe" : "risk", ready, riskItems, checks };
}

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
const directionLabel = direction => direction === "enToJa" ? "英語 → 日本語" : "日本語 → 英語";

function renderTestQuestion(session, range) {
  const question = session.questions[session.index], word = range.words.find(w => w.id === question.wordId);
  const prompt = session.direction === "enToJa" ? word.word : meanings(word).join("／");
  return `<div class="test-progress"><span>${session.index + 1} / ${session.questions.length}</span><span>${directionLabel(session.direction)}</span></div>
    <div class="test-progressbar"><span style="width:${(session.index / session.questions.length) * 100}%"></span></div>
    <div class="test-prompt">${escapeHtml(prompt)}</div>
    ${session.direction === "enToJa" ? `<button class="soft test-replay" data-test-action="replay">もう一度聞く</button>` : ""}
    <div class="test-choices">${question.choices.map((choice, i) => `<button class="test-choice" data-test-choice="${i}">${escapeHtml(choice.label)}</button>`).join("")}</div>`;
}

function answerTestQuestion(session, range, selectedPosition, now = Date.now()) {
  if (session.finished || session.answers.some(a => a.questionIndex === session.index)) return null;
  const question = session.questions[session.index];
  const correct = selectedPosition === question.correctPosition;
  const responseMs = Math.max(0, Math.min(300000, now - session.questionStartedAt));
  const answer = { questionIndex: session.index, wordId: question.wordId, selectedPosition, selectedWordId: question.choices[selectedPosition]?.wordId || "", correct, responseMs, category: question.category };
  session.answers.push(answer);
  return answer;
}

function finishTest(session, range) {
  session.finished = true;
  session.finishedAt = new Date().toISOString();
  const correct = session.answers.filter(a => a.correct).length;
  const result = { id: session.id, direction: session.direction, mode: session.mode || "normal", startedAt: session.startedAt, finishedAt: session.finishedAt, total: session.questions.length, correct, accuracy: Math.round(correct / session.questions.length * 100), averageResponseMs: Math.round(session.answers.reduce((sum, a) => sum + a.responseMs, 0) / Math.max(1, session.answers.length)), categoryCorrect: {}, wrongWordIds: session.answers.filter(a => !a.correct).map(a => a.wordId) };
  ["urgent", "untested", "normal", "wrong", "ready"].forEach(category => { result.categoryCorrect[category] = session.answers.filter(a => a.category === category && a.correct).length; });
  range.testHistory = [...(range.testHistory || []), result].slice(-30);
  return result;
}

function abortTest(session) { session.aborted = true; session.finished = true; return session; }

function runTestFeatureSelfCheck() {
  const words = Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, word: `word${i}`, normalized: `word${i}`, meaningsJa: [`意味${i}`], studyStatus: i < 3 ? "hard" : "unrated", partOfSpeech: i % 2 ? "noun" : "verb", testStats: i < 3 ? { enToJa: { lastResult: "incorrect" } } : {} }));
  const session = createTestSession({ id: "r", words }, "enToJa", () => 0.37);
  const repeatedSession = createTestSession({ id: "r", words }, "enToJa", () => 0.37);
  const jaSession = createTestSession({ id: "r", words }, "jaToEn", () => 0.37);
  const positionCounts = session.questions.reduce((counts, q) => (counts[q.correctPosition]++, counts), [0, 0, 0, 0]);
  const wrong = createTestSession({ id: "r", words }, "enToJa", { mode: "wrong" }, () => 0.37);
  words[0].testStats = { enToJa: { lastResult: "correct" }, jaToEn: { lastResult: "incorrect" } };
  words[0].studyStatus = "unrated";
  const directionWrong = createTestSession({ id: "r", words }, "enToJa", { mode: "wrong" }, () => 0.37);
  const speed = createSpeedReviewSession({ id: "r", words }, ["w0", "w1", "w2"], 1000);
  rateSpeedReviewWord(speed, "instant", 2000);
  rateSpeedReviewWord(speed, "unsure", 3000);
  const roundResult = rateSpeedReviewWord(speed, "unknown", 4000);
  const testStatsSnapshot = JSON.stringify(words.map(word => word.testStats));
  rateSpeedReviewWord(speed, "instant", 5000);
  rateSpeedReviewWord(speed, "instant", 6000);
  const restarted = restartSpeedReviewSession(speed, 7000);
  const positions = [0, 1, 2, 3, 14, 15, 16].map(count => buildAnswerPositions(count, () => 0.37));
  const positionsSafe = positions.every((items, index) => {
    const count = [0, 1, 2, 3, 14, 15, 16][index], counts = [0, 0, 0, 0];
    items.forEach(position => counts[position]++);
    return items.length === count && Math.max(...counts) - Math.min(...counts) <= 1 && !items.some((position, itemIndex) => itemIndex > 1 && position === items[itemIndex - 1] && position === items[itemIndex - 2]);
  });
  const choicesSound = [...session.questions, ...jaSession.questions].every(question => question.choices.length === 4 && new Set(question.choices.map(choice => choice.wordId)).size === 4 && question.choices[question.correctPosition].wordId === question.wordId);
  const deterministicQuestions = JSON.stringify(session.questions) === JSON.stringify(repeatedSession.questions);
  const spellingWord = { id: "spell", word: "co-operate", acceptedSpellings: ["cooperate"], meaningsJa: ["協力する"] };
  const spellingSession = createSpellingSession({ id: "sp", words: [spellingWord] }, null, 1000);
  const spellingAnswer = answerSpellingQuestion(spellingSession, { id: "sp", words: [spellingWord] }, "COOPERATE", 1800);
  const spellingResult = finishSpellingSession(spellingSession, { id: "sp", words: [spellingWord] }, 2000);
  const typoRejected = !evaluateSpellingAnswer(spellingWord, "cooperrate").correct;
  const knownNow = new Date("2026-08-20T12:00:00").getTime();
  const day18 = new Date("2026-08-18T12:00:00").getTime(), day19 = new Date("2026-08-19T12:00:00").getTime(), day21 = new Date("2026-08-21T12:00:00").getTime();
  const addSecureDirections = word => ["enToJa", "jaToEn"].forEach(direction => {
    applyDirectionAttempt(word, direction, { correct: true, responseMs: 2000 }, day18);
    applyDirectionAttempt(word, direction, { correct: true, responseMs: 2000 }, day19);
  });
  const addSecureSpelling = word => {
    applySpellingAttempt(word, { correct: true, answer: word.word }, day18);
    applySpellingAttempt(word, { correct: true, answer: word.word }, day19);
  };
  const readyWord = { id: "ready", word: "readyword", meaningsJa: ["準備"], testStats: {} };
  addSecureDirections(readyWord);
  addSecureSpelling(readyWord);
  const unspelledWord = { id: "unspelled", word: "unspelledword", meaningsJa: ["未確認"], testStats: {} };
  addSecureDirections(unspelledWord);
  const lapseRetryWord = { id: "retry", word: "retryword", meaningsJa: ["再確認"], testStats: {} };
  addSecureDirections(lapseRetryWord);
  applySpellingAttempt(lapseRetryWord, { correct: true, answer: "retryword" }, day18);
  applySpellingAttempt(lapseRetryWord, { correct: false, answer: "retrywrod" }, knownNow);
  applySpellingAttempt(lapseRetryWord, { correct: true, answer: "retryword" }, knownNow + 1000);
  const retrySameDayRisk = !readinessForWord(lapseRetryWord, knownNow).ready;
  applySpellingAttempt(lapseRetryWord, { correct: true, answer: "retryword" }, day21);
  const retryNextDaySafe = readinessForWord(lapseRetryWord, day21).ready;
  const timingRecoveryWord = { id: "timing", word: "timingword", meaningsJa: ["回復"], testStats: {} };
  ["enToJa", "jaToEn"].forEach(direction => {
    applyDirectionAttempt(timingRecoveryWord, direction, { correct: true, responseMs: 7000 }, day18);
    applyDirectionAttempt(timingRecoveryWord, direction, { correct: true, responseMs: 2000 }, day19);
    applyDirectionAttempt(timingRecoveryWord, direction, { correct: true, responseMs: 2000 }, knownNow);
  });
  addSecureSpelling(timingRecoveryWord);
  const timingRecoverySafe = readinessForWord(timingRecoveryWord, knownNow).ready;
  const sameDayOnly = { id: "same", word: "sameword", meaningsJa: ["同日"], testStats: {} };
  ["enToJa", "jaToEn"].forEach(direction => {
    applyDirectionAttempt(sameDayOnly, direction, { correct: true, responseMs: 2000 }, knownNow);
    applyDirectionAttempt(sameDayOnly, direction, { correct: true, responseMs: 2000 }, knownNow + 1000);
  });
  const readiness = readinessForRange({ words: [readyWord, sameDayOnly] }, knownNow);
  const adaptive = { id: "adaptive", word: "adaptive", meaningsJa: ["適応"], testStats: {} };
  const firstAttempt = applyDirectionAttempt(adaptive, "enToJa", { correct: false, responseMs: 7000, selectedWordId: "w1" }, knownNow);
  const secondAttempt = applyDirectionAttempt(adaptive, "enToJa", { correct: true, responseMs: 5000 }, knownNow + 1000);
  const spelling = { accommodate: analyzeSpellingRisk("accommodate"), crucial: analyzeSpellingRisk("crucial"), besides: analyzeSpellingRisk("besides"), science: analyzeSpellingRisk("science"), cat: analyzeSpellingRisk("cat") };
  const passed = !session.error && session.questions.length === 15 && positionCounts.sort().join(",") === "3,4,4,4" &&
    choicesSound && deterministicQuestions &&
    wrong.questions?.every(q => ["w0", "w1", "w2"].includes(q.wordId)) && directionWrong.questions?.every(q => q.wordId !== "w0") &&
    roundResult?.roundComplete && restarted && speed.round === 3 && speed.roundWordIds.join(",") === "w0,w1,w2" && !speed.finished &&
    testStatsSnapshot === JSON.stringify(words.map(word => word.testStats)) &&
    positionsSafe && spellingAnswer?.correct && spellingWord.spellingStats.correct === 1 && spellingResult.correct === 1 && typoRejected &&
    selectTestReadyItems([readyWord, sameDayOnly], "enToJa", 15, knownNow).map(word => word.id).join(",") === "same" && selectWeakItems([unspelledWord], null, 15, knownNow).length === 1 &&
    !readinessForWord(unspelledWord, knownNow).ready && retrySameDayRisk && retryNextDaySafe && timingRecoverySafe &&
    readiness.status === "risk" && !readiness.ready && readiness.riskItems[0].wordId === "same" && firstAttempt?.slow && !firstAttempt.hesitant && secondAttempt && adaptive.testStats.enToJa.lastLapseAt &&
    spelling.accommodate.level === "high" && spelling.crucial.level !== "high" && spelling.besides.level === "low" && spelling.science.level !== "high" && spelling.cat.level === "low";
  return { passed, questionCount: session.questions?.length || 0, positionCounts, wrongCount: wrong.questions?.length || 0, speedRounds: speed.completedRounds.length, spelling, positionsSafe, choicesSound, deterministicQuestions, retrySameDayRisk, retryNextDaySafe, timingRecoverySafe, readiness };
}

window.MWTest = Object.freeze({
  selectTestWords,
  buildChoices,
  buildQuestionOrder,
  buildAnswerPositions,
  createTestSession,
  renderTestQuestion,
  answerTestQuestion,
  finishTest,
  abortTest,
  analyzeSpellingRisk,
  defaultDirectionStats,
  normalizeDirectionStats,
  applyDirectionAttempt,
  normalizeSpellingStats,
  evaluateSpellingAnswer,
  createSpellingSession,
  answerSpellingQuestion,
  finishSpellingSession,
  applySpellingAttempt,
  selectWeakItems,
  selectTestReadyItems,
  readinessForRange,
  createSpeedReviewSession,
  restartSpeedReviewSession,
  rateSpeedReviewWord,
  runTestFeatureSelfCheck
});


