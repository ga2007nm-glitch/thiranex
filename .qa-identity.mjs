export default async function run(page) {
  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.fill('#todo-input', 'Ghost task');
  await page.click('#todo-submit');
  await page.waitForTimeout(80);

  // Step 1: force a re-render (delegated on #todo-list, so the list subtree
  // is replaced while #todo-list itself survives).
  await page.click('.filter-btn[data-filter="all"]');
  await page.waitForTimeout(80);

  // Step 2: are the filter buttons the SAME nodes the app captured at load?
  const identity = await page.evaluate(() => {
    const live = [...document.querySelectorAll('.filter-btn')];
    // The app stored its own references; compare against what's in the DOM now.
    return {
      liveCount: live.length,
      liveIsConnected: live.map((b) => b.isConnected),
      liveTexts: live.map((b) => b.dataset.filter),
      // Render rewrites these attributes, proving render() DID touch these nodes
      ariaPressed: live.map((b) => b.getAttribute('aria-pressed')),
      activeClass: live.map((b) => b.classList.contains('is-active')),
    };
  });

  // Step 3: click a filter programmatically and see if state actually changed.
  const before = await page.evaluate(() =>
    document.querySelector('.filter-btn.is-active').dataset.filter);

  await page.evaluate(() => {
    document.querySelector('.filter-btn[data-filter="active"]').click();
  });
  await page.waitForTimeout(100);

  const after = await page.evaluate(() => ({
    activeFilter: document.querySelector('.filter-btn.is-active').dataset.filter,
    status: document.getElementById('form-status').textContent,
    storedFilter: JSON.parse(localStorage.getItem('gagana.todo.tasks')).filter,
  }));

  // Step 4: resize (which the reduced-motion CSS does not affect) then click
  // a filter again to see whether a layout reflow changes anything.
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(120);
  await page.click('.filter-btn[data-filter="completed"]');
  await page.waitForTimeout(100);

  return {
    identity,
    activeFilterBeforeClick: before,
    afterProgrammaticClick: after,
    afterRealClickAtNarrowWidth: await page.evaluate(() => ({
      activeFilter: document.querySelector('.filter-btn.is-active').dataset.filter,
      storedFilter: JSON.parse(localStorage.getItem('gagana.todo.tasks')).filter,
    })),
  };
}