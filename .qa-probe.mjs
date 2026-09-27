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
  await page.click('.todo-item:has-text("Gamma") .todo-check');
  await page.waitForTimeout(80);
  await page.click('.filter-btn[data-filter="completed"]');
  await page.waitForTimeout(80);

  // Directly probe: does a synthetic click on the delete button reach the
  // handler while the Completed filter is active?
  const synthetic = await page.evaluate(() =>
    new Promise((resolve) => {
      const before = JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.length;
      const btn = document.querySelector('.icon-btn--danger');
      if (!btn) return resolve({ error: 'no delete button' });
      // Add a capture listener to see if the event propagates at all
      let sawCapture = false;
      const spy = () => { sawCapture = true; };
      document.addEventListener('click', spy, true);
      btn.click();
      setTimeout(() => {
        document.removeEventListener('click', spy, true);
        resolve({
          sawCapture,
          before,
          after: JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.length,
          status: document.getElementById('form-status').textContent,
          rowTexts: [...document.querySelectorAll('.todo-item')].map((li) => li.querySelector('.todo-text').textContent),
        });
      }, 150);
    })
  );

  // Now compare against the SAME action with the All filter active
  await page.click('.filter-btn[data-filter="all"]');
  await page.waitForTimeout(80);
  const allFilter = await page.evaluate(() =>
    new Promise((resolve) => {
      const before = JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.length;
      const btn = document.querySelector('.todo-item[data-priority="low"] .icon-btn--danger');
      btn.click();
      setTimeout(() => resolve({
        before,
        after: JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.length,
        status: document.getElementById('form-status').textContent,
      }), 150);
    })
  );

  return { syntheticWhileCompleted: synthetic, syntheticWhileAll: allFilter };
}