const DIRECTIONS = ["enToJa", "jaToEn"];

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

function selectTestWords(words, direction, limit = 15, random = Math.random) {
  const eligible = words.filter(word => word.word && meanings(word).length);
  const canBuild = eligible.filter(word => buildChoices(word, eligible, direction, 0, random));
  const tie = new Map(canBuild.map(word => [word.id, random()]));
  const urgent = canBuild.filter(word => word.studyStatus === "hard" || statFor(word, direction).lastResult === "incorrect");
  const untested = canBuild.filter(word => !statFor(word, direction).attempts && !urgent.includes(word));
  const normal = canBuild.filter(word => !urgent.includes(word) && !untested.includes(word));
  const sortReview = list => [...list].sort((a, b) => {
    const sa = statFor(a, direction), sb = statFor(b, direction);
    return accuracy(sa) - accuracy(sb) || (sa.consecutiveCorrect || 0) - (sb.consecutiveCorrect || 0) ||
      String(sa.lastTestedAt || "").localeCompare(String(sb.lastTestedAt || "")) ||
      (sa.attempts || 0) - (sb.attempts || 0) || tie.get(a.id) - tie.get(b.id);
  });
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
    return value + random();
  };
  const unique = [];
  const seen = new Set();
  [...candidates].sort((a, b) => score(b) - score(a)).forEach(word => {
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
  const counts = [4, 4, 4, 3];
  const bag = counts.flatMap((countAt, position) => Array(Math.min(countAt, Math.max(0, count - counts.slice(0, position).reduce((a, b) => a + b, 0)))).fill(position)).slice(0, count);
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = shuffle(bag, random);
    if (!result.some((v, i) => i > 1 && result[i - 1] === v && result[i - 2] === v)) return result;
  }
  return bag;
}

function buildQuestionOrder(selected, random = Math.random) {
  const groups = {
    urgent: shuffle(selected.filter(x => x.category === "urgent"), random),
    untested: shuffle(selected.filter(x => x.category === "untested"), random),
    normal: shuffle(selected.filter(x => x.category === "normal"), random)
  };
  const result = [];
  while (result.length < selected.length) {
    const lastTwo = result.slice(-2).map(item => item.category);
    const choices = Object.keys(groups).filter(key => groups[key].length && !(lastTwo.length === 2 && lastTwo.every(v => v === key)));
    const key = choices.sort((a, b) => groups[b].length - groups[a].length)[0] || Object.keys(groups).find(k => groups[k].length);
    result.push(groups[key].shift());
  }
  return result;
}

function createTestSession(range, direction, random = Math.random) {
  if (!DIRECTIONS.includes(direction)) throw new Error("Invalid direction");
  const selected = selectTestWords(range.words || [], direction, 15, random);
  if (selected.length < 15) return { error: "日本語訳と有効な選択肢がある単語が15語必要です。" };
  const order = buildQuestionOrder(selected, random);
  const positions = buildAnswerPositions(15, random);
  const questions = order.map((item, index) => ({
    wordId: item.word.id,
    category: item.category,
    correctPosition: positions[index],
    choices: buildChoices(item.word, range.words, direction, positions[index], random)
  }));
  if (questions.some(q => !q.choices)) return { error: "選択肢を作成できない単語があります。" };
  return { id: `test_${Date.now().toString(36)}`, rangeId: range.id, direction, questions, index: 0, answers: [], startedAt: new Date().toISOString(), questionStartedAt: Date.now(), finished: false };
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
    <div class="test-choices">${question.choices.map((choice, i) => `<button class="test-choice" data-test-choice="${i}">${escapeHtml(choice.label)}</button>`).join("")}</div>
    <button class="soft test-abort" data-test-action="abort">テストを中止</button>`;
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
  const result = { id: session.id, direction: session.direction, startedAt: session.startedAt, finishedAt: session.finishedAt, total: session.questions.length, correct, accuracy: Math.round(correct / session.questions.length * 100), averageResponseMs: Math.round(session.answers.reduce((sum, a) => sum + a.responseMs, 0) / Math.max(1, session.answers.length)), categoryCorrect: {}, wrongWordIds: session.answers.filter(a => !a.correct).map(a => a.wordId) };
  ["urgent", "untested", "normal"].forEach(category => { result.categoryCorrect[category] = session.answers.filter(a => a.category === category && a.correct).length; });
  range.testHistory = [...(range.testHistory || []), result].slice(-30);
  return result;
}

function abortTest(session) { session.aborted = true; session.finished = true; return session; }

function runTestFeatureSelfCheck() {
  const words = Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, word: `word${i}`, normalized: `word${i}`, meaningsJa: [`意味${i}`], studyStatus: i < 3 ? "hard" : "unrated", partOfSpeech: i % 2 ? "noun" : "verb", testStats: {} }));
  const session = createTestSession({ id: "r", words }, "enToJa", () => 0.37);
  const positionCounts = session.questions.reduce((counts, q) => (counts[q.correctPosition]++, counts), [0, 0, 0, 0]);
  const passed = !session.error && session.questions.length === 15 && positionCounts.sort().join(",") === "3,4,4,4" && session.questions.every(q => q.choices.length === 4);
  return { passed, questionCount: session.questions?.length || 0, positionCounts };
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
  runTestFeatureSelfCheck
});
