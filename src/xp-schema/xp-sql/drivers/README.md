# drivers

Database driver system for connecting to different database backends. Handles the actual connection logic and query execution for each database type.

Drivers abstract the connection details and provide a unified interface for executing queries. They work in conjunction with dialects to provide complete database abstraction. The system supports PGLite (in-browser PostgreSQL), Postgres (server PostgreSQL), and SQLite Mobile.

