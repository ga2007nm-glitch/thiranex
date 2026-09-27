export default async function run(page) {
  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.fill('#todo-input', 'Trace me');
  await page.click('#todo-submit');
  await page.waitForTimeout(100);

  // Log the full event sequence a real mouse click produces on a filter button.
  await page.evaluate(() => {
    window.__trace = [];
    const record = (phase) => (e) => {
      if (!e.target.closest || !e.target.closest('.filter-btn')) return;
      window.__trace.push({
        phase,
        target: e.target.tagName + '.' + (e.target.className || ''),
        type: e.type,
        filter: e.target.closest('.filter-btn').dataset.filter,
        activeNow: document.querySelector('.filter-btn.is-active')?.dataset.filter,
        activeElement: document.activeElement.tagName + '#' + document.activeElement.id,
      });
    };
    ['pointerdown', 'mousedown', 'focusin', 'pointerup', 'mouseup', 'click'].forEach((t) => {
      document.addEventListener(t, record('bubble:' + t), false);
    });
  });

  await page.click('.filter-btn[data-filter="active"]');
  await page.waitForTimeout(200);

  return {
    trace: await page.evaluate(() => window.__trace),
    finalActive: await page.evaluate(() =>
      document.querySelector('.filter-btn.is-active').dataset.filter),
  };
}