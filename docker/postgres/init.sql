-- Runs once, when the Postgres volume is created (docker-entrypoint-initdb.d).
-- A separate database for server/test/postgres.test.ts, which wipes it on every run.
CREATE DATABASE closet_test OWNER closet;
