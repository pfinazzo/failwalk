const request = require("supertest");
const { app } = require("../app");

describe("POST /signups", () => {
  test("creates the subscription at billing and returns it", async () => {
    const response = await request(app).post("/signups").send({ customerId: "cus_new", planId: "basic" });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: "sub_cus_new", customer_id: "cus_new", status: "active", plan_id: "basic" });
  });
});
