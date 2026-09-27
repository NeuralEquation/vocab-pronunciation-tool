"use strict";
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(require('node:os').homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const { chromium } = playwright;
const executablePath = [process.env.MW_CHROMIUM_EXECUTABLE, chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
(async () => {
 const browser = await chromium.launch({headless:true, executablePath});
 const errors=[];
 try {
 for(const width of [390, 820, 320]) {
  const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1});
  await context.route('https://**',route=>route.abort());
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.MW_TEST_URL || 'http://127.0.0.1:8765/');
  await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  const snap=async(name)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,`${name} overflow at ${width}`);if(width!==320) await page.screenshot({path:path.join(require('node:os').tmpdir(),`mw-ui-${width}-${name}.png`),fullPage:name !== 'session',animations:'disabled'});};
  assert.equal(await page.locator('.welcome-card').isVisible(),true);
  await snap('welcome');
  await page.locator('#tab-ranges').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-import').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Home');
  await page.locator('.welcome-card [data-go]').click();
  assert.equal(await page.locator('#rangeName').evaluate(el=>el===document.activeElement),true);
  await page.locator('#rangeName').fill('Section 59–60');
  await page.locator('#testDate').fill('2026-09-23');
  await page.locator('#wordInput').fill(JSON.stringify([{word:'record',meaning:'記録する',examples:[{en:'Keep a record.',ja:'記録をつける。'}],phrases:[]} ]));
  await snap('import');
  await page.locator('#importRange').click();
  await page.locator('.range-card').waitFor();
  await snap('library');
  await page.locator('[data-action="open"]').click();
  assert.equal(await page.locator('#page-ranges').isVisible(),false);
  assert.equal(await page.locator('#startWordStudy').isVisible(),true);
  assert.equal(await page.locator('#startWordSpeed').isVisible(),false);
  assert.equal(await page.locator('.word-card').isVisible(),false);
  await snap('study');
  await page.locator('#vocabLearningOptions > summary').click();
  await page.locator('#continuousStart').click();
  assert.notEqual(await page.locator('#materialContents').getAttribute('open'),null,'playback reveals its current card');
  await page.locator('#playbackDockStop').click();
  await page.locator('#materialContents > summary').click();
  await page.locator('#vocabLearningOptions > summary').click();
  await page.locator('#morePractice > summary').click();
  assert.equal(await page.locator('#startWordSpeed').isVisible(),true);
  await snap('practice');
  await page.locator('#startWordStudy').click();
  await page.locator('#studySessionLayer:not(.hidden)').waitFor();
  await snap('session');
  await page.locator('#studySessionClose').click();
  if(await page.locator('[data-modal-confirm]').isVisible())await page.locator('[data-modal-confirm]').click();
  await page.locator('#closeWords').click();
  assert.equal(await page.locator('#page-ranges').isVisible(),true);
  await page.locator('[data-action="open"]').click();
  await page.locator('[data-tab="ranges"]').click();
  assert.equal(await page.locator('#page-ranges').isVisible(),true);
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  assert.equal(await page.locator('#page-ranges').isVisible(),true,'returning to the library survives reload');
  assert.equal(await page.locator('#wordPanel').isVisible(),false);

  await page.locator('[data-action="open"]').click();
  await page.locator('[data-tab="import"]').click();
  await page.locator('#rangeFilter').evaluate(select => { select.value = '終了'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#rangeName').fill('Another study range');
  await page.locator('#testDate').fill('2026-09-23');
  await page.locator('#wordInput').fill(JSON.stringify([{word:'apple',meaning:'りんご',examples:[],phrases:[]}]));
  await page.locator('#importRange').click();
  assert.equal(await page.locator('#page-ranges').isVisible(),true,'registration returns to the library');
  assert.equal(await page.locator('#wordPanel').isVisible(),false,'registration does not reopen the old range');
  assert.equal(await page.locator('#rangeFilter').inputValue(),'all','new material is not hidden by an old filter');
  assert.equal(await page.locator('.range-card').count(),2);

  await page.locator('.range-card').filter({hasText:'Section 59'}).locator('[data-action="open"]').click();
  assert.match(await page.locator('#usageList').textContent(),/Keep a record/);
  await page.locator('#vocabLearningOptions > summary').click();
  await page.locator('#wordFilter').selectOption('hard');
  await page.locator('#closeWords').click();
  await page.locator('.range-card').filter({hasText:'Another study range'}).locator('[data-action="open"]').click();
  assert.match(await page.locator('#wordList').textContent(),/この条件に一致する単語はありません/);
  assert.doesNotMatch(await page.locator('#usageList').textContent(),/Keep a record/,'another range cannot show stale examples');
  await page.locator('#wordFilter').selectOption('all');
  await page.locator('#closeWords').click();

  await page.locator('[data-tab="import"]').click();
  await page.locator('#rangeKind').selectOption('memorization');
  await page.locator('#rangeName').fill('Friday memory range');
  await page.locator('#testDate').fill('2026-09-25');
  await page.locator('#memoryInput').fill('I am ready.\t私は準備ができています。');
  await page.locator('#importRange').click();
  await page.locator('.range-card').filter({hasText:'Section 59'}).locator('[data-action="open"]').click();
  assert.match(await page.locator('#usageList').textContent(),/Keep a record/);
  await page.locator('#closeWords').click();
  await page.locator('.range-card').filter({hasText:'Friday memory range'}).locator('[data-action="open"]').click();
  assert.equal((await page.locator('#usageList').textContent()).trim(),'','memory material cannot show vocabulary examples');
  await page.locator('#closeWords').click();

  await page.locator('[data-tab="backup"]').click();
  assert.equal(await page.locator('#exportJson').isVisible(),true);
  assert.equal(await page.locator('#wipeAll').isVisible(),false);
  await snap('data');
  await page.locator('#recoveryOptions > summary').click();
  assert.equal(await page.locator('#wipeAll').isVisible(),true);
  await page.locator('[data-tab="settings"]').click();
  assert.equal(await page.locator('#apiKey').isVisible(),false);
  await snap('settings');
  await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS mobile 320/390 and tablet 820: onboarding, registration, disclosures, learning, return navigation, data and settings; no overflow or page errors.');
 }finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
