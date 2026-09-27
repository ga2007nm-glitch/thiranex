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
  await page.waitForTimeout(120);

  // Instrument: log every handler entry by wrapping the list's own listeners
  // is not possible, so instead watch for DOM replacement during the click.
  await page.evaluate(() => {
    window.__events = [];
    const list = document.getElementById('todo-list');
    const observer = new MutationObserver((records) => {
      window.__events.push({
        when: 'mutation',
        removed: records.reduce((n, r) => n + r.removedNodes.length, 0),
        added: records.reduce((n, r) => n + r.addedNodes.length, 0),
      });
    });
    observer.observe(list, { childList: true });

    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach((type) => {
      document.addEventListener(type, (e) => {
        window.__events.push({
          when: 'event:' + type,
          target: e.target.tagName + (e.target.getAttribute && e.target.getAttribute('data-action') ? '[' + e.target.getAttribute('data-action') + ']' : ''),
          detail: e.detail,
          defaultPrevented: e.defaultPrevented,
        });
      }, true);
    });
  });

  await page.click('.todo-item .icon-btn--danger');
  await page.waitForTimeout(300);

  const events = await page.evaluate(() => window.__events);
  const after = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.length,
    status: document.getElementById('form-status').textContent,
  }));

  return { events, after };
}