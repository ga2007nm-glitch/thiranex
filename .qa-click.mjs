export default async function run(page) {
  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.fill('#todo-input', 'Debug target');
  await page.click('#todo-submit');
  await page.waitForTimeout(80);

  // Record every click that reaches document, and what the handler will see.
  await page.evaluate(() => {
    window.__log = [];
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.icon-btn--danger');
      const rowFromTarget = btn ? btn.closest('.todo-item') : null;
      window.__log.push({
        phase: 'doc-capture-ish',
        targetTag: e.target.tagName,
        targetClass: e.target.className,
        defaultPrevented: e.defaultPrevented,
        btnFound: !!btn,
        rowFromBtn: rowFromTarget ? rowFromTarget.getAttribute('data-id') : null,
      });
    }, true);
  });

  const btn = page.locator('.icon-btn--danger');
  await btn.click();
  await page.waitForTimeout(150);

  return {
    log: await page.evaluate(() => window.__log),
    remaining: await page.evaluate(() => document.querySelectorAll('.todo-item').length),
    stored: await page.evaluate(() => JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.length),
    geometry: await page.evaluate(() => {
      const b = document.querySelector('.icon-btn--danger');
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        centre: { cx: Math.round(cx), cy: Math.round(cy) },
        topElementAtCentre: hit ? hit.tagName + '.' + hit.className : null,
        isTheButtonItself: hit === b,
        rowGridCols: getComputedStyle(b.closest('.todo-item')).gridTemplateColumns,
      };
    }),
  };
}