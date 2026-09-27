export default async function run(page) {
  const out = {};

  const snap = () => page.evaluate(() => ({
    rows: [...document.querySelectorAll('.todo-item')].map((li) =>
      `${li.getAttribute('data-priority')}:${li.querySelector('.todo-text').textContent}` +
      (li.classList.contains('is-completed') ? ' [done]' : '')),
    counts: {
      all: document.querySelector('[data-count="all"]').textContent,
      active: document.querySelector('[data-count="active"]').textContent,
      completed: document.querySelector('[data-count="completed"]').textContent,
    },
    activeFilter: document.querySelector('.filter-btn.is-active').dataset.filter,
    summary: document.getElementById('list-summary').textContent,
    clearDisabled: document.getElementById('clear-completed').disabled,
    emptyVisible: !document.getElementById('empty-state').hidden,
  }));

  const stored = () => page.evaluate(() => {
    const raw = localStorage.getItem('gagana.todo.tasks');
    const parsed = raw ? JSON.parse(raw) : { tasks: [], filter: 'all' };
    return {
      count: parsed.tasks.length,
      completed: parsed.tasks.filter((t) => t.completed).length,
      filter: parsed.filter,
      texts: parsed.tasks.map((t) => t.text),
    };
  });

  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  out['1_empty'] = await snap();

  // ---------- CREATE ----------
  for (const [t, p] of [['Alpha', 'high'], ['Beta', 'low'], ['Gamma', 'medium']]) {
    await page.fill('#todo-input', t);
    await page.selectOption('#todo-priority', p);
    await page.click('#todo-submit');
    await page.waitForTimeout(60);
  }
  out['2_created'] = await snap();
  out['2_storage'] = await stored();

  // ---------- UPDATE: toggle ----------
  await page.click('.todo-item:has-text("Gamma") .todo-check');
  await page.waitForTimeout(100);
  out['3_toggled'] = await snap();

  // ---------- UPDATE: inline edit ----------
  await page.click('.todo-item:has-text("Beta") [data-action="edit"]');
  await page.waitForTimeout(100);
  await page.fill('.todo-edit-input', 'Beta revised');
  await page.selectOption('.todo-edit-priority', 'high');
  await page.click('[data-action="save"]');
  await page.waitForTimeout(100);
  out['4_edited'] = await snap();

  // ---------- FILTER: completed (Gamma is the only done one) ----------
  await page.click('.filter-btn[data-filter="completed"]');
  await page.waitForTimeout(100);
  out['5_filterCompleted'] = await snap();

  // ---------- DELETE while filtered on completed ----------
  await page.click('.todo-item .icon-btn--danger');
  await page.waitForTimeout(120);
  out['6_deletedWhileFiltered'] = await snap();
  out['6_storage'] = await stored();

  // ---------- FILTER: active ----------
  await page.click('.filter-btn[data-filter="active"]');
  await page.waitForTimeout(100);
  out['7_filterActive'] = await snap();

  // ---------- PERSISTENCE ----------
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
  out['8_afterReload'] = await snap();
  out['8_storage'] = await stored();

  // Complete both remaining tasks, then clear them
  for (const t of ['Alpha', 'Beta revised']) {
    await page.click(`.todo-item:has-text("${t}") .todo-check`);
    await page.waitForTimeout(80);
  }
  out['9_allCompleted'] = await snap();

  await page.click('#clear-completed');
  await page.waitForTimeout(120);
  out['10_afterClear'] = await snap();
  out['10_storage'] = await stored();

  return out;
}