# xpdb-viewer

React Native database viewer UI components for databases managed with `xpdb-schema`.

## Installation

```bash
npm install xpdb-viewer xpdb-schema
```

### Peer Dependencies

```bash
npm install react react-native expo-router expo-document-picker drizzle-orm
```

## Features

- 📊 **Table Viewer** - Display and browse table data with sorting, filtering, and pagination
- 🔍 **Query Editor** - Execute SQL queries and view results
- 🗂️ **Database Browser** - Navigate databases, tables, and views with a sidebar
- 📱 **React Native** - Built for React Native and Expo
- 🎨 **Customizable** - Flexible components you can integrate into your app

## Quick Start

### Basic Table Viewer

```typescript
import { TableViewer } from 'xpdb-viewer';
import { connect } from 'xpdb-schema';

const db = await connect(connInfo);
const data = await db.users.select();

<TableViewer
  columns={[
    { name: 'id', label: 'ID' },
    { name: 'name', label: 'Name' },
  ]}
  rows={data.map((row, idx) => ({ id: String(idx), ...row }))}
/>
```

### Database Browser Layout

```typescript
import { DatabaseBrowserLayout } from 'xpdb-viewer';
import { useRouter } from 'expo-router';

function MyDatabasePage() {
  const router = useRouter();
  
  const handleNavigate = (dbName, tableName, searchParams) => {
    // Navigate to the appropriate page
    router.push({
      pathname: '/database/[db]/[table]',
      params: { db: dbName, table: tableName, ...searchParams }
    });
  };

  return (
    <DatabaseBrowserLayout
      dbName="my-database"
      onNavigate={handleNavigate}
      currentTableName="users"
    >
      {/* Your table or query view content */}
    </DatabaseBrowserLayout>
  );
}
```

### Query Editor

```typescript
import { QueryEditor } from 'xpdb-viewer';
import { connect } from 'xpdb-schema';

function QueryPage() {
  const [results, setResults] = useState([]);
  const db = await connect(connInfo);

  const handleExecute = async (query: string) => {
    try {
      const result = await db.execute(sql.raw(query));
      setResults(result.rows);
    } catch (error) {
      console.error('Query error:', error);
    }
  };

  return (
    <QueryEditor
      onExecute={handleExecute}
      initialQuery="SELECT * FROM users LIMIT 10;"
    />
  );
}
```

## Components

### `DatabaseBrowserLayout`

Main layout component with sidebar for navigating databases and tables.

**Props:**
- `dbName: string` - Name of the current database
- `onNavigate: NavigateCallback` - Callback for navigation
- `children: ReactNode` - Content to display in the main area
- `currentTableName?: string` - Currently selected table
- `showSidebar?: boolean` - Show/hide sidebar
- `onBack?: () => void` - Back button handler

### `TableViewer`

Generic table viewer component for displaying tabular data.

**Props:**
- `columns: TableViewerColumn[]` - Column definitions
- `rows: TableViewerRow[]` - Row data
- `loading?: boolean` - Loading state
- `onRowPress?: (row: TableViewerRow) => void` - Row press handler
- `pagination?: boolean` - Enable pagination
- `sortable?: boolean` - Enable column sorting

### `QueryEditor`

SQL query editor component with syntax highlighting and execution.

**Props:**
- `onExecute: (query: string) => void | Promise<void>` - Query execution handler
- `initialQuery?: string` - Initial query text
- `readOnly?: boolean` - Make editor read-only

## Hooks

### `useTableData`

Hook for fetching and managing table data.

```typescript
import { useTableData } from 'xpdb-viewer';

const { data, loading, error, refresh } = useTableData({
  db,
  tableName: 'users',
  page: 1,
  pageSize: 50,
});
```

## Requirements

- React Native 0.70+
- Expo SDK 49+ (if using Expo)
- `xpdb-schema` package

## License

Unlicense

