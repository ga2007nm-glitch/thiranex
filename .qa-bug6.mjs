export default async function run(page) {
  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  for (const [t, p] of [['Alpha', 'high'], ['Beta', 'low'], ['Gamma', 'medium']]) {
    await page.fill('#todo-input', t);
    await page.selectOption('#todo-priority', p);
    await page.click('#todo-submit');
    await page.waitForTimeout(50);
  }

  // Make Gamma completed, then view the Completed filter
  await page.click('.todo-item:has-text("Gamma") .todo-check');
  await page.waitForTimeout(80);
  await page.click('.filter-btn[data-filter="completed"]');
  await page.waitForTimeout(80);

  // Now trace a delete click in this state
  await page.evaluate(() => {
    window.__t = [];
    ['pointerdown', 'mousedown', 'focusin', 'mouseup', 'click'].forEach((type) => {
      document.addEventListener(type, (e) => {
        const btn = e.target.closest && e.target.closest('.icon-btn--danger');
        window.__t.push({
          type,
          onDeleteBtn: !!btn,
          rowStillPresent: btn ? btn.closest('.todo-item').isConnected : null,
          activeEl: document.activeElement.tagName,
          connectedNow: btn ? btn.isConnected : null,
        });
      }, true); // capture phase, runs before any handler can mutate the DOM
    });
  });

  const before = await page.evaluate(() => ({
    rowTexts: [...document.querySelectorAll('.todo-item')].map((li) => li.querySelector('.todo-text').textContent),
    storedCount: JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.length,
  }));

  await page.click('.todo-item .icon-btn--danger');
  await page.waitForTimeout(200);

  return {
    before,
    trace: await page.evaluate(() => window.__t),
    after: await page.evaluate(() => ({
      rowTexts: [...document.querySelectorAll('.todo-item')].map((li) => li.querySelector('.todo-text').textContent),
      storedCount: JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.length,
      counts: [...document.querySelectorAll('.filter-count')].map((s) => s.textContent),
      status: document.getElementById('form-status').textContent,
    })),
  };
}