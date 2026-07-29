
# Merriam-Webster Pronunciation Checker

A PWA for checking pronunciation, parts of speech, and short definitions with the Merriam-Webster Learner's Dictionary API before vocabulary quizzes based on *Sokudoku Eitango*, a Japanese English vocabulary book.

## Using with GitHub Pages

1. Upload the files in this folder to a GitHub repository.
2. Enable GitHub Pages.
3. Open the published URL on your smartphone and add it to your home screen.
4. Enter your API key directly on the smartphone screen.

## About the API Key

* The API key is not included in this repository.
* The API key is not written in the code or in any sample file.
* The API key is not included in JSON or CSV exports.
* Demo mode is enabled by default, so simply opening the page does not send any API requests.

## PWA Notes

The service worker only caches the app files. Merriam-Webster API responses and audio files are not stored in the PWA cache.

## Vocabulary, Examples, and Phrases

Choose **英単語・例文・熟語** on the registration screen. The recommended Custom GPT output is:

```text
W001	record	記録／記録する
W002	expense	費用／出費
```

```text
E001	example	W001,W002	Keep a record of your expenses.	出費を記録しておきなさい。
P001	phrase	W002	at the expense of A	Aを犠牲にして
```

The app uses only the explicit word IDs in the third column. It does not guess or automatically confirm links. Links can be reviewed and edited after registration. Legacy two-column word rows and two-column example rows remain accepted.

Examples and phrases are recalled from Japanese to the complete English text. After revealing the answer, rate it with `○`, `△`, or `×`. `△` and `×` are repeated in the same session; two consecutive `○` ratings mark an item as settled. There are no cloze or word-order questions.

The Quizlet export contains examples only in `English[TAB]Japanese` format. Phrase rows and internal IDs are excluded.

## Friday Memorization

Choose **金曜の暗記構文** and paste:

```text
M001	1	I am ready for the test.	私はテストの準備ができています。
```

Memorization uses the same full-text `○` / `△` / `×` recall flow, but its data and progress are independent from vocabulary tests and speed review. Only text and progress are stored, so the feature does not add audio files to localStorage.

## Rollback and Backups

The repository tag `stable-before-superapp-2026-07-29` identifies the code before this change. Work is kept on the `agent/superapp-learning` branch.

On the first load, the app keeps a one-time copy of the existing main data when it is small enough to duplicate safely. The backup screen can export or restore this copy. JSON export remains the recommended manual backup before a large import. API keys are never included.

### Feedback and bug reports

Bug reports and feature suggestions are welcome through GitHub Issues.
Please do not include API keys or personal information in issues or pull requests.
