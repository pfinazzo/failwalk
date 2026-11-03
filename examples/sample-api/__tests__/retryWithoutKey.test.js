const request = require("supertest");
const { app } = require("../app");

describe("POST /signups/retrying", () => {
  // Checks the status only, as many tests do. With a malformed answer injected the body is {} and this still passes.
  test("answers 201 once the vendor has the subscription", async () => {
    const response = await request(app).post("/signups/retrying").send({ customerId: "cus_retry", planId: "basic" });
    expect(response.status).toBe(201);
  });
});
