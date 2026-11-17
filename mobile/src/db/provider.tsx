import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import type { ReactNode } from 'react';
import { initializeDatabase } from './migrate';

/**
 * One database connection for the whole app. `onInit` must be a stable
 * reference or a re-render reopens the database.
 */
export function DatabaseProvider({ children }: { children: ReactNode }) {
  return (
    <SQLiteProvider databaseName="stocksure.db" onInit={initializeDatabase}>
      {children}
    </SQLiteProvider>
  );
}

export type Database = SQLiteDatabase;
