/* ==========================================================================
   TASK MANAGER — Application Logic
   --------------------------------------------------------------------------
   Architecture: one-way data flow.

     state  ──render()──▶  DOM
       ▲                     │
       └── events ───────────┘

   The DOM is never the source of truth. Every interaction mutates `state`,
   persists it, and then re-renders from scratch. That makes the three
   operations that must stay in agreement — UI, storage, and filters —
   impossible to desynchronise.

   Persistence layer: window.localStorage (JSON-serialised).
   ========================================================================== */

(function () {
  'use strict';

  /* ========================================================================
     1. CONSTANTS & DOM REFERENCES
     ======================================================================== */

  var STORAGE_KEY = 'gagana.todo.tasks';

  var FILTERS = ['all', 'active', 'completed'];

  var PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

  var el = {
    form: document.getElementById('todo-form'),
    input: document.getElementById('todo-input'),
    priority: document.getElementById('todo-priority'),
    status: document.getElementById('form-status'),
    list: document.getElementById('todo-list'),
    summary: document.getElementById('list-summary'),
    emptyState: document.getElementById('empty-state'),
    emptyTitle: document.getElementById('empty-title'),
    emptyDetail: document.getElementById('empty-detail'),
    clearCompleted: document.getElementById('clear-completed'),
    filterButtons: Array.prototype.slice.call(
      document.querySelectorAll('.filter-btn')
    ),
    counters: {
      all: document.querySelector('[data-count="all"]'),
      active: document.querySelector('[data-count="active"]'),
      completed: document.querySelector('[data-count="completed"]')
    }
  };

  /* ========================================================================
     2. STATE
     `state` is the single source of truth for what the user sees.
     `editingId` is transient view state — it is deliberately NOT persisted,
     because an interrupted edit should not survive a reload.
     ======================================================================== */

  var state = {
    tasks: [],
    filter: 'all'
  };

  var editingId = null;

  /* ========================================================================
     3. PERSISTENCE
     Every read and write is wrapped: localStorage can throw in private
     browsing modes and in sandboxed iframes, and a storage failure must
     degrade to "works for this session" rather than a broken page.
     ======================================================================== */

  function loadState() {
    var raw = null;

    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn('Task persistence unavailable (storage read blocked):', error);
      return;
    }

    if (!raw) return;

    try {
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.tasks)) return;

      // Normalise every record on the way in. Stored data is untrusted input:
      // it may have been hand-edited in DevTools, written by an older schema,
      // or truncated mid-write.
      //
      // A record is only dropped when it has no usable text at all. Any other
      // field that is missing or malformed is repaired with a default, because
      // discarding a task the user can still see would be data loss.
      state.tasks = parsed.tasks
        .filter(function (task) {
          return task && typeof task.text === 'string' && task.text.trim() !== '';
        })
        .map(function (task) {
          return {
            id: typeof task.id === 'string' && task.id !== '' ? task.id : createId(),
            text: task.text.trim().slice(0, 240),
            completed: task.completed === true,
            priority: PRIORITY_ORDER.hasOwnProperty(task.priority)
              ? task.priority
              : 'medium',
            createdAt: typeof task.createdAt === 'number' && isFinite(task.createdAt)
              ? task.createdAt
              : Date.now()
          };
        });

      if (FILTERS.indexOf(parsed.filter) !== -1) {
        state.filter = parsed.filter;
      }
    } catch (error) {
      // Corrupt payload: drop it rather than letting it break every load.
      console.warn('Stored task data was unreadable and has been reset:', error);
      state.tasks = [];
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ tasks: state.tasks, filter: state.filter })
      );
    } catch (error) {
      console.warn('Could not persist tasks (storage write blocked):', error);
    }
  }

  /* ========================================================================
     4. HELPERS
     ======================================================================== */

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function findTask(id) {
    for (var i = 0; i < state.tasks.length; i += 1) {
      if (state.tasks[i].id === id) return state.tasks[i];
    }
    return null;
  }

  function indexOfTask(id) {
    for (var i = 0; i < state.tasks.length; i += 1) {
      if (state.tasks[i].id === id) return i;
    }
    return -1;
  }

  function counts() {
    var completed = 0;

    for (var i = 0; i < state.tasks.length; i += 1) {
      if (state.tasks[i].completed) completed += 1;
    }

    return {
      all: state.tasks.length,
      completed: completed,
      active: state.tasks.length - completed
    };
  }

  /* Applies the active filter, then sorts by priority and recency.
     Sorting happens at read time so the stored array keeps insertion order. */
  function visibleTasks() {
    var matching = state.tasks.filter(function (task) {
      if (state.filter === 'active') return !task.completed;
      if (state.filter === 'completed') return task.completed;
      return true;
    });

    return matching.sort(function (a, b) {
      var byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (byPriority !== 0) return byPriority;
      return b.createdAt - a.createdAt; // newest first within a priority
    });
  }

  function announce(message, isError) {
    el.status.textContent = message;
    el.status.classList.toggle('is-error', Boolean(isError));
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  /* ========================================================================
     5. RENDERING
     Each row is built with createElement + textContent — never innerHTML —
     so user-entered text is structurally incapable of being parsed as markup.
     ======================================================================== */

  function buildTaskRow(task, index) {
    var isEditing = task.id === editingId;

    var li = document.createElement('li');
    li.className = 'todo-item' + (task.completed ? ' is-completed' : '');
    li.setAttribute('data-id', task.id);
    li.setAttribute('data-priority', task.priority);

    if (isEditing) {
      li.classList.add('is-editing');
      li.appendChild(buildEditRow(task));
      return li;
    }

    /* --- Checkbox (Update: toggle completed) --- */
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'todo-check';
    checkbox.checked = task.completed;
    checkbox.id = 'check-' + task.id;
    checkbox.setAttribute('data-action', 'toggle');
    checkbox.setAttribute(
      'aria-label',
      (task.completed ? 'Mark as active: ' : 'Mark as completed: ') + task.text
    );

    /* --- Text label --- */
    var label = document.createElement('label');
    label.className = 'todo-text';
    label.setAttribute('for', checkbox.id);
    label.textContent = task.text;
    label.setAttribute('data-action', 'edit'); // double-click to edit
    label.title = 'Double-click to edit';

    /* --- Meta line --- */
    var meta = document.createElement('p');
    meta.className = 'todo-meta';

    var priorityTag = document.createElement('span');
    priorityTag.className = 'priority-tag priority-tag--' + task.priority;
    priorityTag.textContent = task.priority;

    var date = document.createElement('span');
    date.className = 'todo-date';
    date.textContent = 'Added ' + formatDate(task.createdAt);

    meta.appendChild(priorityTag);
    meta.appendChild(date);

    var body = document.createElement('div');
    body.className = 'todo-body';
    body.appendChild(label);
    body.appendChild(meta);

    /* --- Actions --- */
    var actions = document.createElement('div');
    actions.className = 'todo-actions';

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.setAttribute('data-action', 'edit');
    editBtn.setAttribute('aria-label', 'Edit task: ' + task.text);
    editBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M12 20h9"></path>' +
      '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>';

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'icon-btn icon-btn--danger';
    deleteBtn.setAttribute('data-action', 'delete');
    deleteBtn.setAttribute('aria-label', 'Delete task: ' + task.text);
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M3 6h18"></path>' +
      '<path d="M8 6V4h8v2"></path>' +
      '<path d="M19 6l-1 14H6L5 6"></path>' +
      '<path d="M10 11v6M14 11v6"></path></svg>';

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(checkbox);
    li.appendChild(body);
    li.appendChild(actions);

    // Position in the visible list, for the screen-reader summary
    li.setAttribute('aria-posinset', String(index + 1));
    li.setAttribute('aria-setsize', String(visibleTasks().length));

    return li;
  }

  function buildEditRow(task) {
    var wrapper = document.createElement('div');
    wrapper.className = 'todo-edit';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'todo-edit-input';
    input.value = task.text;
    input.maxLength = 240;
    input.setAttribute('aria-label', 'Edit task description');

    var priority = document.createElement('select');
    priority.className = 'todo-edit-priority';
    priority.setAttribute('aria-label', 'Edit task priority');
    ['low', 'medium', 'high'].forEach(function (level) {
      var option = document.createElement('option');
      option.value = level;
      option.textContent = level.charAt(0).toUpperCase() + level.slice(1);
      if (level === task.priority) option.selected = true;
      priority.appendChild(option);
    });

    var save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn--sm';
    save.setAttribute('data-action', 'save');
    save.textContent = 'Save';

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--ghost btn--sm';
    cancel.setAttribute('data-action', 'cancel');
    cancel.textContent = 'Cancel';

    wrapper.appendChild(input);
    wrapper.appendChild(priority);
    wrapper.appendChild(save);
    wrapper.appendChild(cancel);

    return wrapper;
  }

  function render() {
    var tasks = visibleTasks();
    var tally = counts();

    /* --- List --- */
    el.list.textContent = ''; // clear without innerHTML

    var fragment = document.createDocumentFragment();
    tasks.forEach(function (task, index) {
      fragment.appendChild(buildTaskRow(task, index));
    });
    el.list.appendChild(fragment);

    /* --- Empty state --- */
    var isEmpty = tasks.length === 0;
    el.emptyState.hidden = !isEmpty;

    if (isEmpty) {
      if (state.filter === 'active') {
        el.emptyTitle.textContent = 'No active tasks.';
        el.emptyDetail.textContent = 'Everything is done — nice work.';
      } else if (state.filter === 'completed') {
        el.emptyTitle.textContent = 'Nothing completed yet.';
        el.emptyDetail.textContent = 'Tick a task to see it collected here.';
      } else {
        el.emptyTitle.textContent = 'Nothing here yet.';
        el.emptyDetail.textContent = 'Add your first task above to get started.';
      }
    }

    /* --- Counters --- */
    el.counters.all.textContent = tally.all;
    el.counters.active.textContent = tally.active;
    el.counters.completed.textContent = tally.completed;

    /* --- Filter button states --- */
    el.filterButtons.forEach(function (button) {
      var isActive = button.getAttribute('data-filter') === state.filter;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    /* --- Clear-completed availability --- */
    el.clearCompleted.disabled = tally.completed === 0;

    /* --- Screen-reader summary --- */
    if (tally.all === 0) {
      el.summary.textContent = 'No tasks.';
    } else {
      el.summary.textContent =
        'Showing ' + tasks.length + ' of ' + tally.all + ' tasks. ' +
        tally.active + ' active, ' + tally.completed + ' completed.';
    }

    /* --- Restore focus after a rebuild --------------------------------
       Rebuilding the list destroys whatever the user had focused, which would
       otherwise break keyboard navigation (focus would jump to <body>). We
       can only do this safely when focus was NOT inside a row we just
       replaced: focusing a brand-new node during the same interaction that
       triggered the render is what makes a click land on a detached element. */
    if (editingId) {
      var field = el.list.querySelector('.todo-edit-input');
      var focusWasLost = !el.list.contains(document.activeElement);

      if (field && (focusWasLost || document.activeElement !== field)) {
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
      }
    }
  }

  /* Single place where state changes leave the app: persist, then repaint. */
  function commit() {
    saveState();
    render();
  }

  /* ========================================================================
     6. ACTIONS — the only code allowed to mutate `state.tasks`
     ======================================================================== */

  function addTask(text, priority) {
    var trimmed = text.trim();

    if (!trimmed) {
      announce('Enter a task description before adding.', true);
      el.input.focus();
      return false;
    }

    state.tasks.push({
      id: createId(),
      text: trimmed.slice(0, 240),
      completed: false,
      priority: PRIORITY_ORDER.hasOwnProperty(priority) ? priority : 'medium',
      createdAt: Date.now()
    });

    // A new task is always visible, so drop out of a filter that would hide it.
    if (state.filter === 'completed') {
      state.filter = 'all';
    }

    commit();
    announce('Task added: ' + trimmed);
    return true;
  }

  function toggleTask(id) {
    var task = findTask(id);
    if (!task) return;

    task.completed = !task.completed;
    commit();
    announce((task.completed ? 'Completed: ' : 'Reopened: ') + task.text);
  }

  function updateTask(id, text, priority) {
    var task = findTask(id);
    if (!task) return;

    var trimmed = text.trim();
    if (!trimmed) {
      announce('A task description cannot be empty.', true);
      return;
    }

    task.text = trimmed.slice(0, 240);
    if (PRIORITY_ORDER.hasOwnProperty(priority)) {
      task.priority = priority;
    }

    editingId = null;
    commit();
    announce('Task updated: ' + task.text);
  }

  function deleteTask(id) {
    var index = indexOfTask(id);
    if (index === -1) return;

    var removed = state.tasks[index];
    state.tasks.splice(index, 1);

    if (editingId === id) editingId = null;

    commit();
    announce('Deleted: ' + removed.text);
  }

  function clearCompleted() {
    var before = state.tasks.length;

    state.tasks = state.tasks.filter(function (task) {
      return !task.completed;
    });

    var removedCount = before - state.tasks.length;
    if (removedCount === 0) return;

    commit();
    announce(
      'Cleared ' + removedCount + ' completed task' + (removedCount === 1 ? '' : 's') + '.'
    );
  }

  function setFilter(filter) {
    if (FILTERS.indexOf(filter) === -1) return;

    state.filter = filter;
    editingId = null; // abandon an in-progress edit when the view changes
    commit();
  }

  /* ========================================================================
     7. EVENT HANDLING
     ======================================================================== */

  /* --- Create: form submit (covers both Enter and the button) --- */
  el.form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (addTask(el.input.value, el.priority.value)) {
      el.input.value = '';
      el.input.focus();
    }
  });

  /* --- Filters + clear-completed ---------------------------------------
     These are direct listeners because the controls are static: they exist
     once, at load, and are never re-created by render(). */
  el.filterButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      setFilter(button.getAttribute('data-filter'));
    });
  });

  el.clearCompleted.addEventListener('click', clearCompleted);

  /* --- Task list: DELEGATED listeners -----------------------------------
     One listener on the <ul> serves every row, present and future. Rows are
     rebuilt on every render, so per-item listeners would need constant
     re-binding and would leak on removal. Delegation sidesteps both. */

  el.list.addEventListener('click', function (event) {
    var row = event.target.closest('.todo-item');
    if (!row) return;

    var id = row.getAttribute('data-id');

    /* Resolve the action from the nearest ancestor that declares one.
       A real mouse click usually lands on the inner <svg> icon, not the
       <button>, and the <svg> carries no data-action — reading
       event.target directly would silently resolve to null and the click
       would do nothing. `closest` walks up to the <button>. */
    var control = event.target.closest('[data-action]');
    var action = control ? control.getAttribute('data-action') : null;

    // A click on the row body (but not on a control) saves an open editor.
    if (!action && row.classList.contains('is-editing')) {
      var saveBtn = row.querySelector('[data-action="save"]');
      if (saveBtn) {
        updateTask(
          id,
          row.querySelector('.todo-edit-input').value,
          row.querySelector('.todo-edit-priority').value
        );
      }
      return;
    }

    switch (action) {
      case 'toggle':
        toggleTask(id);
        break;

      case 'delete':
        deleteTask(id);
        break;

      case 'edit':
        editingId = id;
        render();
        break;

      case 'save':
        updateTask(
          id,
          row.querySelector('.todo-edit-input').value,
          row.querySelector('.todo-edit-priority').value
        );
        break;

      case 'cancel':
        editingId = null;
        render();
        announce('Edit cancelled.');
        break;

      default:
        break;
    }
  });

  /* Double-click anywhere on the row body opens the editor. */
  el.list.addEventListener('dblclick', function (event) {
    var body = event.target.closest('.todo-body');
    if (!body) return;

    // Ignore double-clicks that started on a control (the checkbox, or the
    // edit/delete buttons) — only the inert text area opens the editor.
    var control = event.target.closest('[data-action]');
    if (control && control.getAttribute('data-action') !== 'edit') return;

    var row = body.closest('.todo-item');
    editingId = row.getAttribute('data-id');
    render();
  });

  /* Keyboard delegation: Escape cancels, Enter saves (and stops the enclosing
     form from submitting when the field is inside one). */
  el.list.addEventListener('keydown', function (event) {
    var row = event.target.closest('.todo-item');
    if (!row) return;

    var id = row.getAttribute('data-id');

    if (event.key === 'Escape' && row.classList.contains('is-editing')) {
      event.preventDefault();
      editingId = null;
      render();
      announce('Edit cancelled.');
      return;
    }

    if (event.key === 'Enter' && event.target.classList.contains('todo-edit-input')) {
      event.preventDefault();
      updateTask(
        id,
        event.target.value,
        row.querySelector('.todo-edit-priority').value
      );
    }
  });

  /* ========================================================================
     8. INITIALISE
     ======================================================================== */

  loadState();
  render();

  // Expose a tiny read-only handle for debugging and automated checks.
  window.todoApp = {
    getState: function () {
      return { tasks: state.tasks.slice(), filter: state.filter };
    },
    STORAGE_KEY: STORAGE_KEY
  };
})();