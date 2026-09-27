export default async function run(page) {
  const out = {};
  const snapshot = () => page.evaluate(() => ({
    rows: [...document.querySelectorAll('.todo-item')].map((li) => ({
      id: li.getAttribute('data-id'),
      text: li.querySelector('.todo-text')?.textContent,
      priority: li.getAttribute('data-priority'),
    })),
    storedCount: JSON.parse(localStorage.getItem('gagana.todo.tasks') || 'null').tasks.length,
  }));

  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  for (const [t, p] of [['Alpha', 'high'], ['Beta', 'low'], ['Gamma', 'medium']]) {
    await page.fill('#todo-input', t);
    await page.selectOption('#todo-priority', p);
    await page.click('#todo-submit');
    await page.waitForTimeout(50);
  }

  out.before = await snapshot();

  // Target the button actually inside the row whose text is "Beta".
  const betaId = await page.evaluate(() => {
    const li = [...document.querySelectorAll('.todo-item')]
      .find((r) => r.querySelector('.todo-text').textContent === 'Beta');
    return li.getAttribute('data-id');
  });
  out.betaId = betaId;

  await page.click(`.todo-item[data-id="${betaId}"] .icon-btn--danger`);
  await page.waitForTimeout(100);
  out.afterDeleteBeta = await snapshot();

  // And delete by targeting the row via its text content instead of priority.
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('.todo-item')]
      .find((r) => r.querySelector('.todo-text').textContent === 'Gamma');
    li.querySelector('.icon-btn--danger').click();
  });
  await page.waitForTimeout(100);
  out.afterDeleteGamma = await snapshot();

  // Persistence of the deletions
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(150);
  out.afterReload = await snapshot();

  return out;
}