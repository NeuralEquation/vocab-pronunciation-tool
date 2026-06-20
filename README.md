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
