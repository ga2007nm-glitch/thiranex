export default async function run(page) {
  const out = {};

  const rows = () => page.evaluate(() =>
    [...document.querySelectorAll('.todo-item')].map((li) =>
      `${li.getAttribute('data-priority')}:${li.querySelector('.todo-text')?.textContent}` +
      (li.classList.contains('is-completed') ? ' [done]' : '')));

  const stored = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.length);

  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  // ------------------------------------------------------------------
  // XSS safety: task text is inserted with textContent, not innerHTML
  // ------------------------------------------------------------------
  const payload = '<img src=x onerror="window.__xss=1">';
  await page.fill('#todo-input', payload);
  await page.click('#todo-submit');
  await page.waitForTimeout(120);
  out.xss = await page.evaluate(() => ({
    injected: !!window.__xss,
    imgElementsInList: document.querySelectorAll('#todo-list img').length,
    renderedLiterally: document.querySelector('.todo-text').textContent,
  }));

  // ------------------------------------------------------------------
  // Corrupt storage must not brick the page
  // ------------------------------------------------------------------
  await page.evaluate(() => localStorage.setItem('gagana.todo.tasks', '{not valid json'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(120);
  out.corruptStorage = {
    rowCount: (await rows()).length,
    emptyVisible: await page.evaluate(() => !document.getElementById('empty-state').hidden),
  };

  // Junk records inside otherwise-valid JSON get repaired, not discarded
  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('gagana.todo.tasks', JSON.stringify({
    tasks: [
      { id: 'a', text: 'Good task', completed: false, priority: 'high', createdAt: 1 },
      { id: 'b', text: '   ', completed: false, priority: 'low', createdAt: 2 },
      { id: 'c', completed: true, priority: 'nonsense', createdAt: 3 },
      { id: 'd', text: 'Bad priority', completed: false, priority: 'URGENT', createdAt: 4 },
      { id: 'e', text: 'No meta at all' },
    ],
    filter: 'nonsense-filter',
  })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(120);
  out.sanitised = {
    rows: await rows(),
    repairedCount: await page.evaluate(() =>
      JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.length),
    filterFellBackTo: await page.evaluate(() =>
      document.querySelector('.filter-btn.is-active').dataset.filter),
  };

  // ------------------------------------------------------------------
  // Delete with the pristine filter, then confirm persistence
  // ------------------------------------------------------------------
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  for (const [t, p] of [['Alpha', 'high'], ['Beta', 'low'], ['Gamma', 'medium']]) {
    await page.fill('#todo-input', t);
    await page.selectOption('#todo-priority', p);
    await page.click('#todo-submit');
    await page.waitForTimeout(50);
  }
  out.threeAdded = await rows();

  // Filter to Active, then delete from within the filtered view
  await page.click('.filter-btn[data-filter="active"]');
  await page.waitForTimeout(60);
  await page.click('.todo-item:has-text("Beta") .icon-btn--danger');
  await page.waitForTimeout(100);
  out.afterDeleteInFilter = {
    rows: await rows(),
    stored: await stored(),
    summary: await page.evaluate(() => document.getElementById('list-summary').textContent),
  };

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(150);
  out.afterReload = { rows: await rows(), stored: await stored() };

  // ------------------------------------------------------------------
  // Deleting everything brings the empty state back
  // ------------------------------------------------------------------
  for (const t of ['Alpha', 'Gamma']) {
    await page.click(`.todo-item:has-text("${t}") .icon-btn--danger`);
    await page.waitForTimeout(80);
  }
  out.afterDeleteAll = {
    rows: (await rows()).length,
    stored: await stored(),
    emptyVisible: await page.evaluate(() => !document.getElementById('empty-state').hidden),
    emptyTitle: await page.evaluate(() => document.getElementById('empty-title').textContent),
    emptyDetail: await page.evaluate(() => document.getElementById('empty-detail').textContent),
    summary: await page.evaluate(() => document.getElementById('list-summary').textContent),
  };

  return out;
}