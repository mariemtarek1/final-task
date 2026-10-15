import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '../App.jsx';
import * as api from '../api.js';

describe('Inventory & Operations Dispatch - Bug Fixes & Regressions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (api._resetServerDb) {
      api._resetServerDb();
    }
  });

  // Bug 1: Save and counters
  describe('Bug 1: Save and counters', () => {
    it('persists exact current state in payload and updates counters accurately', async () => {
      render(<App />);

      // Wait for tasks to load
      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      // Check initial stats counters
      expect(screen.getByText('Visible tasks').nextElementSibling).toHaveTextContent('10');
      // Verify initial total units is a valid number > 0
      const totalUnitsEl = screen.getByText('Total stock units').nextElementSibling;
      const initialTotal = parseInt(totalUnitsEl.textContent, 10);
      expect(initialTotal).toBeGreaterThan(0);
      expect(totalUnitsEl.textContent).not.toContain('NaN');

      const stockInput = within(screen.getByText('TSK-101').closest('tr'))
        .getByLabelText(/stock units for tsk-101/i);
      fireEvent.change(stockInput, { target: { value: '55' } });

      // Click "Save Now"
      const saveNowBtn = screen.getByRole('button', { name: /save now/i });
      fireEvent.click(saveNowBtn);

      // Saves completed counter should increment to 1
      expect(screen.getByText(/saves completed: 1/i)).toBeInTheDocument();

      // Last Saved Payload should contain current state with tasks and stats
      const payloadEl = screen.getByText(/"savedAt"/i);
      expect(payloadEl).toBeInTheDocument();
      const payload = JSON.parse(payloadEl.textContent);
      expect(payload.stats.totalUnits).toBe(initialTotal + 10);
      expect(payload.tasks.find((task) => task.id === 'TSK-101').stockUnits).toBe(55);
      expect(payload.tasks.length).toBe(10);
      expect(payload.stats.visibleTasks).toBe(10);
      expect(payload.stats.totalUnits).toBe(initialTotal + 10);
    });
  });

  // Bug 2: Undo / Redo
  describe('Bug 2: Undo/Redo', () => {
    it('reliably restores previous state on undo, advances on redo, and prevents loops', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      const undoBtn = screen.getByRole('button', { name: /undo/i });
      const redoBtn = screen.getByRole('button', { name: /redo/i });

      // Initially undo and redo should be disabled
      expect(undoBtn).toBeDisabled();
      expect(redoBtn).toBeDisabled();

      // Change stock units of TSK-101
      const tsk101Row = screen.getByText('TSK-101').closest('tr');
      const unitsInput = within(tsk101Row).getByLabelText(/stock units for tsk-101/i);
      const originalValue = unitsInput.value;

      fireEvent.change(unitsInput, { target: { value: '99' } });
      expect(unitsInput.value).toBe('99');
      expect(undoBtn).not.toBeDisabled();
      expect(redoBtn).toBeDisabled();

      // Click Undo
      fireEvent.click(undoBtn);
      expect(unitsInput.value).toBe(originalValue);
      expect(undoBtn).toBeDisabled();
      expect(redoBtn).not.toBeDisabled();

      // Click Redo
      fireEvent.click(redoBtn);
      expect(unitsInput.value).toBe('99');
      expect(undoBtn).not.toBeDisabled();
      expect(redoBtn).toBeDisabled();

      // Repeated undo/redo does not loop or duplicate
      fireEvent.click(undoBtn);
      expect(unitsInput.value).toBe(originalValue);
      fireEvent.click(redoBtn);
      expect(unitsInput.value).toBe('99');
    });
  });

  // Bug 3: Search race conditions
  describe('Bug 3: Search race conditions', () => {
    it('cancels or ignores obsolete search responses and displays newer results', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/search by title/i);

      // Rapidly type "r" (which takes 1800ms) then "recalibrate" (which takes 250ms)
      fireEvent.change(searchInput, { target: { value: 'r' } });
      fireEvent.change(searchInput, { target: { value: 'recalibrate' } });

      // Faster query "recalibrate" matches TSK-103
      await waitFor(() => {
        expect(screen.getByText('TSK-103')).toBeInTheDocument();
        expect(screen.queryByText('TSK-101')).not.toBeInTheDocument();
      }, { timeout: 1500 });

      // Even if slower request finishes later, it should not overwrite "recalibrate"
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      });
      expect(screen.getByText('TSK-103')).toBeInTheDocument();
      expect(screen.queryByText('TSK-101')).not.toBeInTheDocument();
    });

    it('handles empty results and search errors gracefully', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/search by title/i);
      fireEvent.change(searchInput, { target: { value: 'non_existent_query_xyz' } });

      await waitFor(() => {
        expect(screen.getByText(/no tasks match the current search or filter criteria/i)).toBeInTheDocument();
      });
    });
  });

  // Bug 4: Sorting
  describe('Bug 4: Sorting', () => {
    it('immediately sorts rows deterministically and reverses order without delay', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      const sortBtn = screen.getByRole('button', { name: /sort by priority/i });
      const reverseBtn = screen.getByRole('button', { name: /reverse order/i });

      // Initial first row
      const firstRowBefore = screen.getAllByRole('row')[1]; // row index 1 is first data row
      const firstIdBefore = within(firstRowBefore).getByText(/TSK-/).textContent;

      // Click Sort by Priority
      fireEvent.click(sortBtn);

      // Should immediately re-render sorted by priority
      const rowsAfterSort = screen.getAllByRole('row').slice(1);
      const priorities = rowsAfterSort.map((r) => within(r).getByText(/Urgent|High|Medium|Low/).textContent);

      // Ascending priority: Low -> Medium -> High -> Urgent
      expect(priorities[0]).toBe('Low');

      // Click Sort by Priority again for Descending
      fireEvent.click(sortBtn);
      const rowsAfterDesc = screen.getAllByRole('row').slice(1);
      const descPriorities = rowsAfterDesc.map((r) => within(r).getByText(/Urgent|High|Medium|Low/).textContent);
      expect(descPriorities[0]).toBe('Urgent');

      // Click Reverse
      fireEvent.click(reverseBtn);
      const rowsAfterReverse = screen.getAllByRole('row').slice(1);
      const revPriorities = rowsAfterReverse.map((r) => within(r).getByText(/Urgent|High|Medium|Low/).textContent);
      expect(revPriorities[0]).toBe('Low');
    });
  });

  // Bug 5: Row notes
  describe('Bug 5: Row notes', () => {
    it('associates notes with stable unique row IDs, keeping notes attached after sorting', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-102')).toBeInTheDocument();
      });

      // Type note on TSK-102
      const tsk102Row = screen.getByText('TSK-102').closest('tr');
      const noteInput102 = within(tsk102Row).getByLabelText(/note for tsk-102/i);
      fireEvent.change(noteInput102, { target: { value: 'Battery replacement needed ASAP' } });
      fireEvent.blur(noteInput102);

      expect(noteInput102.value).toBe('Battery replacement needed ASAP');

      // Sort by priority (which moves TSK-102 to a different visual position)
      const sortBtn = screen.getByRole('button', { name: /sort by priority/i });
      fireEvent.click(sortBtn);

      // Note on TSK-102 must still be 'Battery replacement needed ASAP'
      const tsk102RowAfter = screen.getByText('TSK-102').closest('tr');
      const noteInput102After = within(tsk102RowAfter).getByLabelText(/note for tsk-102/i);
      expect(noteInput102After.value).toBe('Battery replacement needed ASAP');

      // Note on another task (e.g. TSK-101) must remain empty
      const tsk101Row = screen.getByText('TSK-101').closest('tr');
      const noteInput101 = within(tsk101Row).getByLabelText(/note for tsk-101/i);
      expect(noteInput101.value).toBe('');
    });

    it('undo restores the note value from before the edit', async () => {
      render(<App />);
      await waitFor(() => expect(screen.getByText('TSK-102')).toBeInTheDocument());

      const note = within(screen.getByText('TSK-102').closest('tr'))
        .getByLabelText(/note for tsk-102/i);
      fireEvent.change(note, { target: { value: 'Check battery stock' } });
      fireEvent.click(screen.getByRole('button', { name: /undo/i }));

      expect(note).toHaveValue('');
    });
  });

  // Bug 6: Bulk actions
  describe('Bug 6: Bulk actions', () => {
    it('applies bulk completion to ALL selected rows, not just the first one', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      // Select TSK-101 and TSK-102
      const select101 = screen.getByLabelText(/select tsk-101/i);
      const select102 = screen.getByLabelText(/select tsk-102/i);
      fireEvent.click(select101);
      fireEvent.click(select102);

      // Click Mark Complete
      const markCompleteBtn = screen.getByRole('button', { name: /mark complete/i });
      fireEvent.click(markCompleteBtn);

      // Both TSK-101 and TSK-102 must be marked Completed
      const row101 = screen.getByText('TSK-101').closest('tr');
      const row102 = screen.getByText('TSK-102').closest('tr');
      expect(within(row101).getByText('Completed')).toBeInTheDocument();
      expect(within(row102).getByText('Completed')).toBeInTheDocument();
    });

    it('applies bulk restock (+10 units) to ALL selected rows', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      const row101 = screen.getByText('TSK-101').closest('tr');
      const row102 = screen.getByText('TSK-102').closest('tr');
      const input101 = within(row101).getByLabelText(/stock units for tsk-101/i);
      const input102 = within(row102).getByLabelText(/stock units for tsk-102/i);

      const val101 = parseInt(input101.value, 10);
      const val102 = parseInt(input102.value, 10);

      // Select both
      fireEvent.click(screen.getByLabelText(/select tsk-101/i));
      fireEvent.click(screen.getByLabelText(/select tsk-102/i));

      // Click Restock +10
      const restockBtn = screen.getByRole('button', { name: /restock \+10/i });
      fireEvent.click(restockBtn);

      expect(parseInt(input101.value, 10)).toBe(val101 + 10);
      expect(parseInt(input102.value, 10)).toBe(val102 + 10);
    });
  });

  // Bug 7: Inventory calculations
  describe('Bug 7: Inventory calculations', () => {
    it('validates numeric input, disallows negative values, and derives correct totals without string concatenation', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      const totalUnitsEl = screen.getByText('Total stock units').nextElementSibling;
      const initialTotal = parseInt(totalUnitsEl.textContent, 10);

      const tsk101Row = screen.getByText('TSK-101').closest('tr');
      const unitsInput = within(tsk101Row).getByLabelText(/stock units for tsk-101/i);
      const originalVal = parseInt(unitsInput.value, 10);

      // Change units by adding 50
      fireEvent.change(unitsInput, { target: { value: String(originalVal + 50) } });

      // Total units should increase strictly by 50, not concatenated strings like "04550"
      expect(parseInt(totalUnitsEl.textContent, 10)).toBe(initialTotal + 50);

      // Change units to negative value: should clamp to 0
      fireEvent.change(unitsInput, { target: { value: '-25' } });
      expect(parseInt(unitsInput.value, 10)).toBe(0);
      expect(parseInt(totalUnitsEl.textContent, 10)).toBe(initialTotal - originalVal);

      fireEvent.change(unitsInput, { target: { value: '7.8' } });
      expect(unitsInput.value).toBe('7');
      expect(Number(totalUnitsEl.textContent)).toBe(initialTotal - originalVal + 7);
    });
  });

  // Bug 8: Selection consistency
  describe('Bug 8: Selection consistency', () => {
    it('maintains consistent selection, supports select-all, and synchronizes selection counter', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      const selectAllCheckbox = screen.getByLabelText(/select all visible tasks/i);
      expect(selectAllCheckbox.checked).toBe(false);

      // Click select-all
      fireEvent.click(selectAllCheckbox);

      // All 10 tasks should now be selected
      expect(selectAllCheckbox.checked).toBe(true);
      expect(screen.getByTestId('selected-counter')).toHaveTextContent('10 of 10 visible selected');

      // Deselect one item
      const select101 = screen.getByLabelText(/select tsk-101/i);
      fireEvent.click(select101);

      // selectAll checkbox should be indeterminate
      expect(selectAllCheckbox.checked).toBe(false);
      expect(selectAllCheckbox.indeterminate).toBe(true);
      expect(screen.getByTestId('selected-counter')).toHaveTextContent('9 of 10 visible selected');

      // Clear selection button
      const clearBtn = screen.getByRole('button', { name: /clear selection/i });
      fireEvent.click(clearBtn);

      expect(selectAllCheckbox.checked).toBe(false);
      expect(selectAllCheckbox.indeterminate).toBe(false);
      expect(screen.getByTestId('selected-counter')).toHaveTextContent('0 of 10 visible selected');
    });

    it('maintains consistent selection across filters and clears selection correctly', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      // Select TSK-101 (Priority: High) and TSK-102 (Priority: Urgent)
      fireEvent.click(screen.getByLabelText(/select tsk-101/i));
      fireEvent.click(screen.getByLabelText(/select tsk-102/i));

      expect(screen.getByTestId('selected-counter')).toHaveTextContent('2 of 10 visible selected');

      // Now filter by Priority: Urgent
      const prioritySelect = screen.getByLabelText(/priority/i);
      fireEvent.change(prioritySelect, { target: { value: 'Urgent' } });

      // In Urgent, TSK-102 is visible, TSK-101 is hidden
      // Selected counter should reflect visible vs total: 1 of 3 visible selected (2 total selected)
      await waitFor(() => {
        expect(screen.getByTestId('selected-counter')).toHaveTextContent('1 of 3 visible selected');
        expect(screen.getByTestId('selected-counter')).toHaveTextContent('(2 total selected)');
      });

      // Clear selection button clears all
      fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));
      expect(screen.getByTestId('selected-counter')).toHaveTextContent('0 of 3 visible selected');
    });

    it('keeps a selected row selected while a search temporarily hides it', async () => {
      render(<App />);
      await waitFor(() => expect(screen.getByText('TSK-101')).toBeInTheDocument());

      fireEvent.click(screen.getByLabelText(/select tsk-101/i));
      const searchInput = screen.getByPlaceholderText(/search by title/i);
      fireEvent.change(searchInput, { target: { value: 'recalibrate' } });

      await waitFor(() => expect(screen.queryByText('TSK-101')).not.toBeInTheDocument());
      expect(screen.getByText('TSK-103')).toBeInTheDocument();
      expect(screen.getByTestId('selected-counter')).toHaveTextContent('(1 total selected)');

      fireEvent.change(searchInput, { target: { value: '' } });
      await waitFor(() => expect(screen.getByLabelText(/select tsk-101/i)).toBeChecked());
    });

    it('bulk-updates selected rows even when search currently hides them', async () => {
      const updateSpy = vi.spyOn(api, 'updateTask');
      render(<App />);
      await waitFor(() => expect(screen.getByText('TSK-101')).toBeInTheDocument());
      fireEvent.click(screen.getByLabelText(/select tsk-101/i));

      const searchInput = screen.getByPlaceholderText(/search by title/i);
      fireEvent.change(searchInput, { target: { value: 'recalibrate' } });
      await waitFor(() => expect(screen.queryByText('TSK-101')).not.toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /mark complete/i }));
      await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('TSK-101', { status: 'Completed' }));

      fireEvent.change(searchInput, { target: { value: '' } });
      const row101 = await screen.findByText('TSK-101');
      await waitFor(() => expect(within(row101.closest('tr')).getByText('Completed')).toBeInTheDocument());
    });
  });

  describe('Edge Cases & Advanced Scenarios', () => {
    it('handles bulk action partial failures with clear warning message', async () => {
      // Mock updateTask to reject for TSK-102
      vi.spyOn(api, 'updateTask').mockImplementation(async (id, patch) => {
        if (id === 'TSK-102') {
          throw new Error('Database write error');
        }
        return { id, ...patch };
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByLabelText(/select tsk-101/i));
      fireEvent.click(screen.getByLabelText(/select tsk-102/i));

      fireEvent.click(screen.getByRole('button', { name: /mark complete/i }));

      // Warning message should appear
      await waitFor(() => {
        expect(screen.getByText(/1 task\(s\) failed to update on the server/i)).toBeInTheDocument();
      });

      const row101 = screen.getByText('TSK-101').closest('tr');
      const row102 = screen.getByText('TSK-102').closest('tr');
      expect(within(row101).getByText('Completed')).toBeInTheDocument();
      expect(within(row102).getByText('Pending')).toBeInTheDocument();
      expect(screen.getByText('Completed', { selector: 'span.label' }).nextElementSibling)
        .toHaveTextContent('2');
    });

    it('rolls back failed restock rows and keeps totals consistent', async () => {
      vi.spyOn(api, 'updateTask').mockImplementation(async (id, patch) => {
        if (id === 'TSK-102') throw new Error('Database write error');
        return { id, ...patch };
      });

      render(<App />);
      await waitFor(() => expect(screen.getByText('TSK-101')).toBeInTheDocument());

      const totalUnits = screen.getByText('Total stock units').nextElementSibling;
      const initialTotal = Number(totalUnits.textContent);
      const input101 = within(screen.getByText('TSK-101').closest('tr'))
        .getByLabelText(/stock units for tsk-101/i);
      const input102 = within(screen.getByText('TSK-102').closest('tr'))
        .getByLabelText(/stock units for tsk-102/i);
      const original102 = input102.value;

      fireEvent.click(screen.getByLabelText(/select tsk-101/i));
      fireEvent.click(screen.getByLabelText(/select tsk-102/i));
      fireEvent.click(screen.getByRole('button', { name: /restock \+10/i }));

      await waitFor(() => expect(screen.getByText(/1 task\(s\) failed to update on the server/i)).toBeInTheDocument());
      expect(Number(input101.value)).toBe(55);
      expect(input102.value).toBe(original102);
      expect(Number(totalUnits.textContent)).toBe(initialTotal + 10);
    });

    it('clears redo history when a new action is performed after undo', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      const undoBtn = screen.getByRole('button', { name: /undo/i });
      const redoBtn = screen.getByRole('button', { name: /redo/i });

      const tsk101Row = screen.getByText('TSK-101').closest('tr');
      const unitsInput = within(tsk101Row).getByLabelText(/stock units for tsk-101/i);

      // Edit 1
      fireEvent.change(unitsInput, { target: { value: '50' } });
      expect(unitsInput.value).toBe('50');

      // Undo Edit 1
      fireEvent.click(undoBtn);
      expect(unitsInput.value).toBe('45');
      expect(redoBtn).not.toBeDisabled();

      // Perform a new edit while redo was available
      fireEvent.change(unitsInput, { target: { value: '75' } });
      expect(unitsInput.value).toBe('75');

      // Redo should now be disabled (cleared by new action)
      expect(redoBtn).toBeDisabled();
    });

    it('handles empty input in stock units field by falling back to 0', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('TSK-101')).toBeInTheDocument();
      });

      const tsk101Row = screen.getByText('TSK-101').closest('tr');
      const unitsInput = within(tsk101Row).getByLabelText(/stock units for tsk-101/i);

      fireEvent.change(unitsInput, { target: { value: '' } });
      expect(unitsInput.value).toBe('0');
    });
  });
});

