# kv

Cross-platform key-value storage system with factory and driver implementations. Automatically selects the appropriate storage driver based on the detected platform (IndexedDB for web, AsyncStorage for mobile, FileSystem for node).

The KV system provides a unified interface for persistent key-value storage across different platforms. It's used internally by the registry storage system to persist database connection configurations and can be used for any application-level key-value needs.

## Usage

```typescript
import { getStorage, initializeStorage } from './kv';

// Initialize storage (auto-detects platform)
await initializeStorage();

// Get storage instance
const storage = await getStorage();

// Store and retrieve data
await storage.set('my-key', { data: 'value' });
const value = await storage.get('my-key');
await storage.remove('my-key');
```
