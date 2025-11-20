# drivers

Key-value storage driver implementations for different platforms. Each driver implements the `KeyValueStorage` interface, providing platform-specific persistence.

The drivers handle the low-level storage operations for their respective platforms. IndexedDBStorage uses browser IndexedDB, AsyncStorageDriver uses React Native's AsyncStorage, and FileSystemStorage uses Node.js file system operations.

## Usage

```typescript
import { IndexedDBStorage } from './drivers/indexeddb';
import { AsyncStorageDriver } from './drivers/async-storage';
import { FileSystemStorage } from './drivers/file-system';

// Use platform-specific driver directly
const storage = new IndexedDBStorage();
await storage.set('key', 'value');
const value = await storage.get('key');
```
