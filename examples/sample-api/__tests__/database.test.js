const database = require("../config/database");

/** Tests the wrapper directly. Tests are not inventoried, so failwalk reports these calls as UNINVENTORIED. */
describe("database wrapper", () => {
  test("reads a missing record as null", async () => {
    await expect(database.get({ path: "records/nobody" })).resolves.toBeNull();
  });

  test("update merges fields into a record", async () => {
    await database.update({ path: "records/one", value: { a: 1 } });
    await database.update({ path: "records/one", value: { b: 2 } });
    await expect(database.get({ path: "records/one" })).resolves.toEqual({ a: 1, b: 2 });
  });
});
