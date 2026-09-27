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

  return await page.evaluate(() => {
    const btn = document.querySelector('.icon-btn--danger');
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const stack = document.elementsFromPoint(cx, cy).map((n) =>
      n.tagName + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').join('.') : ''));

    return {
      btnRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      btnInViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
      centre: { cx: Math.round(cx), cy: Math.round(cy) },
      hitElement: hit ? hit.tagName + '.' + (hit.className || '') : null,
      hitIsButtonOrChild: hit ? btn === hit || btn.contains(hit) : false,
      stack,
      btnPointerEvents: getComputedStyle(btn).pointerEvents,
      btnVisibility: getComputedStyle(btn).visibility,
      btnDisplay: getComputedStyle(btn).display,
      btnOpacity: getComputedStyle(btn).opacity,
      actionsPointerEvents: getComputedStyle(btn.parentElement).pointerEvents,
      rowPointerEvents: getComputedStyle(btn.closest('.todo-item')).pointerEvents,
    };
  });
}