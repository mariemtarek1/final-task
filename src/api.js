const serverDb = [
  { id: 'TSK-101', title: 'Audit warehouse safety supplies', category: 'Inventory', priority: 'High', stockUnits: 45, status: 'In Progress' },
  { id: 'TSK-102', title: 'Restock barcode scanner batteries', category: 'Hardware', priority: 'Urgent', stockUnits: 12, status: 'Pending' },
  { id: 'TSK-103', title: 'Recalibrate conveyor scale sensor', category: 'Maintenance', priority: 'Low', stockUnits: 80, status: 'Completed' },
  { id: 'TSK-104', title: 'Inspect forklift hydraulic fluid', category: 'Maintenance', priority: 'Medium', stockUnits: 30, status: 'In Progress' },
  { id: 'TSK-105', title: 'Cycle count shelf aisle B4', category: 'Inventory', priority: 'High', stockUnits: 150, status: 'Pending' },
  { id: 'TSK-106', title: 'Replace thermal printer heads', category: 'Hardware', priority: 'Urgent', stockUnits: 6, status: 'Pending' },
  { id: 'TSK-107', title: 'Label returned pallet inventory', category: 'Inventory', priority: 'Medium', stockUnits: 64, status: 'Pending' },
  { id: 'TSK-108', title: 'Service dock door actuators', category: 'Maintenance', priority: 'High', stockUnits: 9, status: 'In Progress' },
  { id: 'TSK-109', title: 'Update handheld scanner firmware', category: 'Hardware', priority: 'Low', stockUnits: 22, status: 'Pending' },
  { id: 'TSK-110', title: 'Reconcile damaged goods ledger', category: 'Inventory', priority: 'Urgent', stockUnits: 18, status: 'Pending' },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const fetchTasks = async (searchQuery = '', category = 'All', options = {}) => {
  const signal = options?.signal;
  const q = (searchQuery || '').trim().toLowerCase();
  const delay = q.length === 1 ? 1800 : 250;

  await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, delay);

    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  return serverDb
    .filter((task) => {
      const matchesSearch =
        !q ||
        task.title.toLowerCase().includes(q) ||
        task.id.toLowerCase().includes(q);
      const matchesCategory = category === 'All' || task.category === category;
      return matchesSearch && matchesCategory;
    })
    .map((task) => ({ ...task }));
};

export const updateTask = async (id, patch) => {
  await wait(120);
  const target = serverDb.find((task) => task.id === id);
  if (target) Object.assign(target, patch);
  return target ? { ...target } : null;
};

const initialServerDb = JSON.parse(JSON.stringify(serverDb));
export const _resetServerDb = () => {
  serverDb.length = 0;
  serverDb.push(...JSON.parse(JSON.stringify(initialServerDb)));
};
