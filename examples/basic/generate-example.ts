
import {schema} from "./schema";

// Check if this file is being run directly
if (require.main === module) {
    schema.gen();
}

