export default async function run(page) {
  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.fill('#todo-input', 'Probe');
  await page.click('#todo-submit');
  await page.waitForTimeout(80);

  return await page.evaluate(() => {
    const li = document.querySelector('.todo-item');
    const btn = li.querySelector('.icon-btn--danger');
    const svg = btn.querySelector('svg');
    const target = svg; // what the real click reports as target

    const rowFromTarget = target.closest('.todo-item');
    const actionFromTarget = target.getAttribute('data-action');

    // Replay the exact decision the delegated handler makes
    const wouldHitEditingBranch =
      !actionFromTarget && rowFromTarget.classList.contains('is-editing');

    return {
      svgTagName: svg.tagName,
      svgNamespace: svg.namespaceURI,
      dataActionOnSvg: svg.getAttribute('data-action'),
      dataActionOnButton: btn.getAttribute('data-action'),
      rowFromSvg: rowFromTarget ? rowFromTarget.getAttribute('data-id') : null,
      rowIsEditing: rowFromTarget.classList.contains('is-editing'),
      wouldHitEditingBranch,
      computedAction: actionFromTarget,
      noteOnSvgGetAttribute: typeof svg.getAttribute('data-action'),
    };
  });
}