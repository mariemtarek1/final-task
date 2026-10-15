import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fetchTasks, updateTask } from './api.js';

const PRIORITY_WEIGHT = { Urgent: 3, High: 2, Medium: 1, Low: 0 };
const LOW_STOCK_LIMIT = 15;

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [bulkError, setBulkError] = useState(null);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // Row notes state: { [taskId]: string }
  const [rowNotes, setRowNotes] = useState({});

  // Auto-save and counters
  const [countdown, setCountdown] = useState(5);
  const [saveCount, setSaveCount] = useState(0);
  const [lastSavedPayload, setLastSavedPayload] = useState(null);

  // Undo / Redo history stacks
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  // Sorting refs and state
  const sortDirection = useRef('desc');
  const requestIdRef = useRef(0);
  const taskCacheRef = useRef({});

  // Derived filtered tasks
  const displayedTasks = useMemo(() => {
    return tasks.filter(
      (task) => priorityFilter === 'All' || task.priority === priorityFilter
    );
  }, [tasks, priorityFilter]);

  // Derived metrics (strictly numeric, never NaN or string concatenation)
  const totalUnits = useMemo(() => {
    return displayedTasks.reduce((sum, t) => sum + (Number(t.stockUnits) || 0), 0);
  }, [displayedTasks]);

  const lowStockCount = useMemo(() => {
    return displayedTasks.filter((t) => (Number(t.stockUnits) || 0) < LOW_STOCK_LIMIT).length;
  }, [displayedTasks]);

  const completedCount = useMemo(() => {
    return displayedTasks.filter((t) => t.status === 'Completed').length;
  }, [displayedTasks]);

  // Keep a ref to latest state so timer/handlers never have stale closures
  const latestStateRef = useRef({});
  latestStateRef.current = {
    tasks,
    selectedTaskIds,
    searchQuery,
    categoryFilter,
    priorityFilter,
    rowNotes,
    displayedTasks,
    totalUnits,
    lowStockCount,
    completedCount,
  };

  // Helper to push a snapshot to undo history
  const pushHistory = useCallback((currentTasks, currentNotes) => {
    setPast((prevPast) => [
      ...prevPast.slice(-49),
      {
        tasks: currentTasks,
        rowNotes: { ...currentNotes },
        taskCache: { ...taskCacheRef.current },
      },
    ]);
    setFuture([]);
  }, []);

  // Save current exact state to payload
  const performSave = useCallback(() => {
    const current = latestStateRef.current;
    const payload = {
      savedAt: new Date().toLocaleTimeString(),
      searchQuery: current.searchQuery,
      categoryFilter: current.categoryFilter,
      priorityFilter: current.priorityFilter,
      selectedTaskIds: [...current.selectedTaskIds],
      tasks: current.tasks.map((t) => ({
        ...t,
        note: current.rowNotes[t.id] || '',
      })),
      rowNotes: { ...current.rowNotes },
      stats: {
        visibleTasks: current.displayedTasks.length,
        totalUnits: current.totalUnits,
        lowStockCount: current.lowStockCount,
        completedCount: current.completedCount,
      },
    };
    setSaveCount((prev) => prev + 1);
    setLastSavedPayload(payload);
  }, []);

  // Search with AbortController and request ID guard against race conditions
  useEffect(() => {
    const currentRequestId = ++requestIdRef.current;
    const controller = new AbortController();

    setIsSearching(true);
    setSearchError(null);

    fetchTasks(searchQuery, categoryFilter, { signal: controller.signal })
      .then((results) => {
        // Discard response if a newer search request has already been initiated
        if (currentRequestId !== requestIdRef.current) return;
        taskCacheRef.current = {
          ...taskCacheRef.current,
          ...Object.fromEntries(results.map((task) => [task.id, task])),
        };
        setTasks(results);
        setIsSearching(false);
        // Reset undo/redo history for new dataset
        setPast([]);
        setFuture([]);
      })
      .catch((err) => {
        if (currentRequestId !== requestIdRef.current || err?.name === 'AbortError') return;
        setSearchError(err?.message || 'Failed to fetch tasks');
        setIsSearching(false);
      });

    return () => {
      controller.abort();
    };
  }, [searchQuery, categoryFilter]);

  // Auto-save timer (runs every 1 second, saves every 5 seconds without stale closures)
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          performSave();
          return 5;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [performSave]);

  // Undo action
  const handleUndo = useCallback(() => {
    if (past.length === 0) return;
    const previousSnapshot = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    setFuture((prevFuture) => [
      { tasks, rowNotes: { ...rowNotes }, taskCache: { ...taskCacheRef.current } },
      ...prevFuture,
    ]);

    setTasks(previousSnapshot.tasks);
    setRowNotes(previousSnapshot.rowNotes);
    taskCacheRef.current = previousSnapshot.taskCache;
    setPast(newPast);
  }, [past, tasks, rowNotes]);

  // Redo action
  const handleRedo = useCallback(() => {
    if (future.length === 0) return;
    const nextSnapshot = future[0];
    const newFuture = future.slice(1);

    setPast((prevPast) => [
      ...prevPast,
      { tasks, rowNotes: { ...rowNotes }, taskCache: { ...taskCacheRef.current } },
    ]);

    setTasks(nextSnapshot.tasks);
    setRowNotes(nextSnapshot.rowNotes);
    taskCacheRef.current = nextSnapshot.taskCache;
    setFuture(newFuture);
  }, [future, tasks, rowNotes]);

  // Deterministic sorting with stable tie-breaker and immediate state update
  const handleSortByPriority = () => {
    sortDirection.current = sortDirection.current === 'asc' ? 'desc' : 'asc';
    const dir = sortDirection.current === 'asc' ? 1 : -1;
    pushHistory(tasks, rowNotes);

    const sorted = [...tasks].sort((a, b) => {
      const diff = (PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]) * dir;
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    setTasks(sorted);
  };

  const handleReverse = () => {
    pushHistory(tasks, rowNotes);
    const reversed = [...tasks].reverse();
    setTasks(reversed);
  };

  // Row selection handlers
  const handleToggleSelect = (taskId) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId]
    );
  };

  const visibleTaskIds = useMemo(() => displayedTasks.map((t) => t.id), [displayedTasks]);
  const visibleSelectedCount = useMemo(() => {
    return displayedTasks.filter((t) => selectedTaskIds.includes(t.id)).length;
  }, [displayedTasks, selectedTaskIds]);

  const allVisibleSelected =
    visibleTaskIds.length > 0 &&
    visibleTaskIds.every((id) => selectedTaskIds.includes(id));

  const someVisibleSelected =
    visibleTaskIds.some((id) => selectedTaskIds.includes(id));

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      // Uncheck all visible
      const visibleSet = new Set(visibleTaskIds);
      setSelectedTaskIds((prev) => prev.filter((id) => !visibleSet.has(id)));
    } else {
      // Select all visible
      const combined = new Set([...selectedTaskIds, ...visibleTaskIds]);
      setSelectedTaskIds(Array.from(combined));
    }
  };

  // Stock inventory calculation and numeric validation
  const handleStockChange = (taskId, rawValue) => {
    pushHistory(tasks, rowNotes);

    const numericValue = Number(rawValue);
    let parsed = Number.isFinite(numericValue) ? Math.floor(numericValue) : 0;
    if (parsed < 0) {
      parsed = 0;
    }

    const nextTasks = tasks.map((t) =>
      t.id === taskId ? { ...t, stockUnits: parsed } : t
    );
    taskCacheRef.current[taskId] = { ...taskCacheRef.current[taskId], stockUnits: parsed };
    setTasks(nextTasks);
    updateTask(taskId, { stockUnits: parsed }).catch((err) => {
      console.error(`Failed to update stock for ${taskId}`, err);
    });
  };

  // Row notes handlers
  const handleNoteChange = (taskId, text) => {
    pushHistory(tasks, rowNotes);
    setRowNotes((prev) => ({ ...prev, [taskId]: text }));
  };

  // Bulk actions on all selected tasks
  const handleBulkComplete = async () => {
    if (isBulkUpdating || selectedTaskIds.length === 0) return;
    const selectedSet = new Set(selectedTaskIds);
    const targetTasks = Object.values(taskCacheRef.current).filter((t) => selectedSet.has(t.id));
    if (targetTasks.length === 0) return;

    pushHistory(tasks, rowNotes);

    // Immutable single-batch update for every selected task
    const nextTasks = tasks.map((t) =>
      selectedSet.has(t.id) ? { ...t, status: 'Completed' } : t
    );
    targetTasks.forEach((task) => {
      taskCacheRef.current[task.id] = { ...task, status: 'Completed' };
    });
    setTasks(nextTasks);
    setIsBulkUpdating(true);

    const results = await Promise.allSettled(
      targetTasks.map((task) => Promise.resolve().then(() => updateTask(task.id, { status: 'Completed' })))
    );
    const failedTasks = targetTasks.filter((_, index) => results[index].status === 'rejected');
    if (failedTasks.length > 0) {
      const failedIds = new Set(failedTasks.map((task) => task.id));
      failedTasks.forEach((task) => {
        taskCacheRef.current[task.id] = task;
      });
      setTasks((currentTasks) => currentTasks.map((task) => (
        failedIds.has(task.id) ? failedTasks.find((failedTask) => failedTask.id === task.id) : task
      )));
      setBulkError(`${failedTasks.length} task(s) failed to update on the server.`);
    } else {
      setBulkError(null);
    }
    setIsBulkUpdating(false);
  };

  const handleBulkRestock = async () => {
    if (isBulkUpdating || selectedTaskIds.length === 0) return;
    const selectedSet = new Set(selectedTaskIds);
    const targetTasks = Object.values(taskCacheRef.current).filter((t) => selectedSet.has(t.id));
    if (targetTasks.length === 0) return;

    pushHistory(tasks, rowNotes);

    // Immutable single-batch update for every selected task (+10 units)
    const nextTasks = tasks.map((t) =>
      selectedSet.has(t.id)
        ? { ...t, stockUnits: (Number(t.stockUnits) || 0) + 10 }
        : t
    );
    targetTasks.forEach((task) => {
      taskCacheRef.current[task.id] = {
        ...task,
        stockUnits: (Number(task.stockUnits) || 0) + 10,
      };
    });
    setTasks(nextTasks);
    setIsBulkUpdating(true);

    const results = await Promise.allSettled(
      targetTasks.map((task) => {
        const nextUnits = (Number(task.stockUnits) || 0) + 10;
        return Promise.resolve().then(() => {
          return updateTask(task.id, { stockUnits: nextUnits });
        });
      })
    );
    const failedTasks = targetTasks.filter((_, index) => results[index].status === 'rejected');
    if (failedTasks.length > 0) {
      const failedIds = new Set(failedTasks.map((task) => task.id));
      failedTasks.forEach((task) => {
        taskCacheRef.current[task.id] = task;
      });
      setTasks((currentTasks) => currentTasks.map((task) => (
        failedIds.has(task.id) ? failedTasks.find((failedTask) => failedTask.id === task.id) : task
      )));
      setBulkError(`${failedTasks.length} task(s) failed to update on the server.`);
    } else {
      setBulkError(null);
    }
    setIsBulkUpdating(false);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Inventory &amp; Operations Dispatch</h1>
          <p className="muted">Warehouse maintenance schedules, restock audits and field units.</p>
        </div>
        <div className="actions">
          <button
            className="btn ghost"
            onClick={handleUndo}
            disabled={past.length === 0}
            title="Undo last change"
          >
            Undo ({past.length})
          </button>
          <button
            className="btn ghost"
            onClick={handleRedo}
            disabled={future.length === 0}
            title="Redo undone change"
          >
            Redo ({future.length})
          </button>
          <button className="btn primary" onClick={handleSortByPriority}>
            Sort by Priority
          </button>
          <button className="btn primary" onClick={handleReverse}>
            Reverse Order
          </button>
        </div>
      </header>

      <section className="grid-3">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="label">Auto-save</span>
            <button
              className="btn ghost small"
              onClick={performSave}
              title="Save current state immediately"
            >
              Save Now
            </button>
          </div>
          <p className="big mono accent">Next auto-save in: {countdown} seconds</p>
          <span className="muted small">Saves completed: {saveCount}</span>
        </div>
        <div className="card span-2">
          <span className="label">Last Saved Payload</span>
          <pre className="payload mono">
            {lastSavedPayload
              ? JSON.stringify(lastSavedPayload, null, 2)
              : 'Awaiting first auto-save...'}
          </pre>
        </div>
      </section>

      <section className="grid-4">
        <div className="card stat">
          <span className="label">Visible tasks</span>
          <p className="big">{displayedTasks.length}</p>
        </div>
        <div className="card stat">
          <span className="label">Total stock units</span>
          <p className="big">{totalUnits}</p>
        </div>
        <div className="card stat">
          <span className="label">Low stock items</span>
          <p className="big warn">{lowStockCount}</p>
        </div>
        <div className="card stat">
          <span className="label">Completed</span>
          <p className="big ok">{completedCount}</p>
        </div>
      </section>

      <section className="card toolbar">
        <div className="search">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title or task code..."
          />
          {isSearching && <span className="querying">Querying...</span>}
        </div>
        <div className="filters">
          <label>
            Category
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="All">All</option>
              <option value="Inventory">Inventory</option>
              <option value="Hardware">Hardware</option>
              <option value="Maintenance">Maintenance</option>
            </select>
          </label>
          <label>
            Priority
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="All">All</option>
              <option value="Urgent">Urgent</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </label>
        </div>
      </section>

      {bulkError && (
        <div className="card warn small" style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}>
          {bulkError}
        </div>
      )}

      <section className="bulkbar">
        <span data-testid="selected-counter">
          <strong>{visibleSelectedCount}</strong> of {displayedTasks.length} visible selected
          {selectedTaskIds.length > visibleSelectedCount && (
            <span className="muted small" style={{ marginLeft: 8 }}>
              ({selectedTaskIds.length} total selected)
            </span>
          )}
        </span>
        <div className="actions">
          {selectedTaskIds.length > 0 && (
            <button
              className="btn ghost small"
              onClick={() => setSelectedTaskIds([])}
            >
              Clear Selection
            </button>
          )}
          <button
            className="btn ghost"
            onClick={handleBulkRestock}
            disabled={!selectedTaskIds.length || isBulkUpdating}
          >
            Restock +10
          </button>
          <button
            className="btn ok"
            onClick={handleBulkComplete}
            disabled={!selectedTaskIds.length || isBulkUpdating}
          >
            Mark Complete
          </button>
        </div>
      </section>

      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th className="center">
                <input
                  type="checkbox"
                  aria-label="Select all visible tasks"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate = someVisibleSelected && !allVisibleSelected;
                    }
                  }}
                  onChange={handleToggleSelectAll}
                />
              </th>
              <th>Task ID</th>
              <th>Operational Item</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Units</th>
              <th>Field Dispatch Notes</th>
            </tr>
          </thead>
          <tbody>
            {searchError ? (
              <tr>
                <td colSpan="8" className="empty" style={{ color: 'var(--danger)' }}>
                  {searchError}
                </td>
              </tr>
            ) : displayedTasks.length === 0 ? (
              <tr>
                <td colSpan="8" className="empty">
                  No tasks match the current search or filter criteria.
                </td>
              </tr>
            ) : (
              displayedTasks.map((task) => (
                <tr
                  key={task.id}
                  className={selectedTaskIds.includes(task.id) ? 'selected' : ''}
                >
                  <td className="center">
                    <input
                      type="checkbox"
                      aria-label={`Select ${task.id}`}
                      checked={selectedTaskIds.includes(task.id)}
                      onChange={() => handleToggleSelect(task.id)}
                    />
                  </td>
                  <td className="mono strong">{task.id}</td>
                  <td>{task.title}</td>
                  <td className="muted">{task.category}</td>
                  <td>
                    <span className={`pill ${task.priority.toLowerCase()}`}>{task.priority}</span>
                  </td>
                  <td>
                    <span className={`status ${task.status.replace(' ', '').toLowerCase()}`}>
                      {task.status}
                    </span>
                  </td>
                  <td>
                    <input
                      className="units"
                      type="number"
                      min="0"
                      aria-label={`Stock units for ${task.id}`}
                      value={task.stockUnits}
                      onChange={(e) => handleStockChange(task.id, e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="note"
                      type="text"
                      aria-label={`Note for ${task.id}`}
                      placeholder="Quick manager note..."
                      value={rowNotes[task.id] || ''}
                      onChange={(e) => handleNoteChange(task.id, e.target.value)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
