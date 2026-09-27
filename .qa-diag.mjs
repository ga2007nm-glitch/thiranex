export default async function run(page) {
  const out = {};
  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  for (const [t, p] of [['Alpha', 'high'], ['Beta', 'low'], ['Gamma', 'medium']]) {
    await page.fill('#todo-input', t);
    await page.selectOption('#todo-priority', p);
    await page.click('#todo-submit');
    await page.waitForTimeout(50);
  }

  const before = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.todo-item')].map((li) => ({
      id: li.getAttribute('data-id'),
      text: li.querySelector('.todo-text').textContent,
      deleteBtnPresent: !!li.querySelector('.icon-btn--danger'),
    })),
    activeFilter: document.querySelector('.filter-btn.is-active').dataset.filter,
  }));
  out.before = before;

  // Switch to Active and look at what the DOM actually contains
  await page.click('.filter-btn[data-filter="active"]');
  await page.waitForTimeout(120);
  out.afterFilterClick = await page.evaluate(() => ({
    activeFilter: document.querySelector('.filter-btn.is-active').dataset.filter,
    rows: [...document.querySelectorAll('.todo-item')].map((li) => ({
      id: li.getAttribute('data-id'),
      text: li.querySelector('.todo-text').textContent,
      deleteBtn: !!li.querySelector('.icon-btn--danger'),
    })),
  }));

  // Which element does a hit-test at the delete button's centre return?
  const btnInfo = await page.evaluate(() => {
    const btn = document.querySelector('.todo-item .icon-btn--danger');
    if (!btn) return { error: 'no delete button found' };
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const row = btn.closest('.todo-item');
    return {
      btnRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
      hitTag: hit ? hit.tagName : null,
      hitIsInsideBtn: hit ? btn.contains(hit) : false,
      rowDataId: row.getAttribute('data-id'),
      rowText: row.querySelector('.todo-text').textContent,
    };
  });
  out.deleteButtonHitTest = btnInfo;

  // Try the click and report what survived
  try {
    await page.click('.todo-item:has-text("Beta") .icon-btn--danger', { timeout: 4000 });
    out.clickResult = 'clicked ok';
  } catch (e) {
    out.clickResult = 'CLICK FAILED: ' + String(e.message).split('\n')[0];
  }
  await page.waitForTimeout(150);

  out.afterDelete = await page.evaluate(() => ({
    rowTexts: [...document.querySelectorAll('.todo-item')].map((li) => li.querySelector('.todo-text').textContent),
    status: document.getElementById('form-status').textContent,
    stored: JSON.parse(localStorage.getItem('gagana.todo.tasks')).tasks.map((t) => t.text),
  }));

  return out;
}