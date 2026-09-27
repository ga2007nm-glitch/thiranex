export default async function run(page) {
  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);

  const ids = ['todo-list', 'todo-form', 'todo-input', 'todo-priority', 'form-status',
    'list-summary', 'empty-state', 'empty-title', 'empty-detail', 'clear-completed'];

  return await page.evaluate((list) => {
    const missing = list.filter((id) => !document.getElementById(id));
    return {
      hasTodoApp: typeof window.todoApp,
      missingIds: missing,
      filterBtnCount: document.querySelectorAll('.filter-btn').length,
      countAll: !!document.querySelector('[data-count="all"]'),
      renderedRows: document.querySelectorAll('.todo-item').length,
      // If init crashed, rows would be 0 AND todoApp undefined
      listChildCount: document.getElementById('todo-list').children.length,
    };
  }, ids);
}