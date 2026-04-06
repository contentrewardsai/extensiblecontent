import assert from "node:assert/strict";
import { isPostgresUniqueViolation } from "../lib/postgres-errors";

assert.equal(isPostgresUniqueViolation({ code: "23505" }), true);
assert.equal(isPostgresUniqueViolation({ message: "duplicate key value violates unique constraint" }), true);
assert.equal(isPostgresUniqueViolation({ message: "UNIQUE constraint failed" }), true);
assert.equal(isPostgresUniqueViolation({ code: "23503", message: "foreign key" }), false);
assert.equal(isPostgresUniqueViolation(null), false);

console.log("unit-tests: postgres-errors OK");
