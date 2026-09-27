export default async function run(page) {
  const out = {};

  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Create tasks one at a time through the real UI
  for (const [t, p] of [['Alpha', 'high'], ['Beta', 'low'], ['Gamma', 'medium']]) {
    await page.fill('#todo-input', t);
    await page.selectOption('#todo-priority', p);
    await page.click('#todo-submit');
    await page.waitForTimeout(70);
  }

  out.afterThreeCreates = await page.evaluate(() => ({
    domRows: document.querySelectorAll('.todo-item').length,
    stored: JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.map((t) => t.text),
    domTexts: [...document.querySelectorAll('.todo-item .todo-text')].map((n) => n.textContent),
  }));

  // Reload and check whether anything duplicates
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
  out.afterOneReload = await page.evaluate(() => ({
    domRows: document.querySelectorAll('.todo-item').length,
    stored: JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.map((t) => t.text),
  }));

  // Reload several more times
  for (let i = 0; i < 4; i += 1) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(120);
  }
  out.afterFiveReloads = await page.evaluate(() => ({
    domRows: document.querySelectorAll('.todo-item').length,
    stored: JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.map((t) => t.text),
    counts: [...document.querySelectorAll('.filter-count')].map((s) => s.textContent),
  }));

  // Does the script get evaluated more than once per load?
  out.scriptInstances = await page.evaluate(() => ({
    scriptSrcCount: document.querySelectorAll('script[src="todo.js"]').length,
    hasApp: typeof window.todoApp === 'object',
  }));

  return out;
}