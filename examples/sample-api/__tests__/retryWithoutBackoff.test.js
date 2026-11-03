const request = require("supertest");
const { app } = require("../app");

describe("GET /subscriptions/:id/status", () => {
  test("reads the status from billing", async () => {
    const response = await request(app).get("/subscriptions/sub_1/status");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "active" });
  });
});
