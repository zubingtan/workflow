-- T5 (#216): Create the secondary database for mem0's app layer (auth, config).
-- The primary database (POSTGRES_DB=mem0) is created automatically by the
-- pgvector image. The app layer (db.py) uses APP_DB_NAME (default: mem0_app).
SELECT 'CREATE DATABASE mem0_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mem0_app')\gexec
