import Storage from 'expo-sqlite/kv-store';

/**
 * Remembers on this phone which first-week steps the owner has already seen,
 * for the Home "Get started" list. Steps that leave a record (a product, a
 * sale) are read from the database instead; these are the ones that do not.
 */
export type VisitStep = 'reconcile' | 'tax';

const PREFIX = 'stocksure.start.';

function read(key: string) {
  try {
    return Storage.getItemSync(PREFIX + key) === '1';
  } catch {
    return false;
  }
}

function write(key: string) {
  try {
    Storage.setItemSync(PREFIX + key, '1');
  } catch {
    // Losing the flag only means the step shows as not done yet.
  }
}

export const hasVisited = (step: VisitStep) => read(step);
export const markVisited = (step: VisitStep) => write(step);
export const isStartListHidden = () => read('hidden');
export const hideStartList = () => write('hidden');
