# dialects

SQL dialect definitions and implementations. Handles SQL syntax differences between database types (PostgreSQL, SQLite, Unbound).

Dialects define how SQL operations are translated for different database backends. The unbound dialect allows tables to be defined without a specific database in mind, then bound to a concrete dialect at runtime.
