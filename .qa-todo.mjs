export default async function run(page, ui) {
  const out = {};
  const read = () => page.evaluate(() => ({
    rows: [...document.querySelectorAll('.todo-item')].map((li) => ({
      text: li.querySelector('.todo-text')?.textContent ?? null,
      completed: li.classList.contains('is-completed'),
      priority: li.getAttribute('data-priority'),
    })),
    emptyVisible: !document.getElementById('empty-state').hidden,
    counts: [...document.querySelectorAll('.filter-count')].map((s) => s.textContent),
    summary: document.getElementById('list-summary').textContent,
    clearDisabled: document.getElementById('clear-completed').disabled,
    stored: JSON.parse(localStorage.getItem('gagana.todo.tasks') || 'null'),
  }));

  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  out.initial = await read();

  // ---- CREATE (three tasks, mixed priority) ----
  const add = async (text, priority) => {
    await page.fill('#todo-input', text);
    await page.selectOption('#todo-priority', priority);
    await page.click('#todo-submit');
    await page.waitForTimeout(60);
  };
  await add('Write the state reducer', 'high');
  await add('Review pull request', 'low');
  await add('Ship the release', 'medium');
  out.afterCreate = await read();

  // ---- Empty-input guard ----
  await page.fill('#todo-input', '   ');
  await page.click('#todo-submit');
  await page.waitForTimeout(60);
  out.blankRejected = {
    status: await page.textContent('#form-status'),
    rowCount: (await read()).rows.length,
  };

  // ---- READ: order should be high -> medium -> low ----
  out.order = (await read()).rows.map((r) => `${r.priority}:${r.text}`);

  // ---- UPDATE: toggle completed via delegated listener ----
  await page.click('.todo-item[data-priority="high"] .todo-check');
  await page.waitForTimeout(80);
  out.afterToggle = await read();

  // ---- UPDATE: inline edit (change text AND priority) ----
  await page.click('.todo-item[data-priority="low"] [data-action="edit"]');
  await page.waitForTimeout(80);
  out.editorOpen = await page.evaluate(() => ({
    editing: document.querySelectorAll('.todo-item.is-editing').length,
    focusedClass: document.activeElement.className,
  }));
  await page.fill('.todo-edit-input', 'Reviewed and merged the PR');
  await page.selectOption('.todo-edit-priority', 'high');
  await page.click('[data-action="save"]');
  await page.waitForTimeout(80);
  out.afterEdit = await read();

  // ---- FILTERS ----
  const clickFilter = async (f) => {
    await page.click(`.filter-btn[data-filter="${f}"]`);
    await page.waitForTimeout(80);
    return read();
  };
  out.filterActive = (await clickFilter('active'));
  out.filterCompleted = (await clickFilter('completed'));
  out.filterAll = (await clickFilter('all'));
  out.ariaPressed = await page.evaluate(() =>
    [...document.querySelectorAll('.filter-btn')].map((b) =>
      `${b.dataset.filter}=${b.getAttribute('aria-pressed')}`));

  // ---- DELETE ----
  await page.click('.todo-item[data-priority="medium"] [data-action="delete"]');
  await page.waitForTimeout(80);
  out.afterDelete = await read();

  // ---- PERSISTENCE: reload and confirm state survived ----
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(150);
  out.afterReload = await read();

  // ---- Restore an active filter across reload ----
  await page.click('.filter-btn[data-filter="completed"]');
  await page.waitForTimeout(60);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(150);
  out.filterPersisted = await page.evaluate(() => ({
    activeFilter: document.querySelector('.filter-btn.is-active').dataset.filter,
    rows: document.querySelectorAll('.todo-item').length,
  }));

  // ---- CLEAR COMPLETED ----
  await page.click('.filter-btn[data-filter="all"]');
  await page.waitForTimeout(60);
  await page.click('#clear-completed');
  await page.waitForTimeout(80);
  out.afterClear = await read();

  // ---- Keyboard: Escape cancels an edit ----
  await add('Temp task', 'low');
  await page.click('.todo-item:last-child [data-action="edit"]');
  await page.waitForTimeout(60);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  out.escapeCancel = await page.evaluate(() => ({
    editing: document.querySelectorAll('.todo-item.is-editing').length,
    status: document.getElementById('form-status').textContent,
  }));

  return out;
}