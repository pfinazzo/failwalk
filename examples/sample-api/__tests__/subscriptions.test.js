const request = require("supertest");
const { app } = require("../app");

describe("GET /subscriptions/:id", () => {
  test("syncs the subscription from billing and returns it", async () => {
    const response = await request(app).get("/subscriptions/sub_1");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: "sub_1", status: "active", plan_id: "premium" });
  });

  test("returns 404 for a subscription billing does not know", async () => {
    const response = await request(app).get("/subscriptions/sub_missing");
    expect(response.status).toBe(404);
  });
});

describe("POST /subscriptions/:id/cancel", () => {
  test("cancels at billing and reports the new status", async () => {
    const response = await request(app).post("/subscriptions/sub_2/cancel");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "cancelled" });
  });
});

describe("POST /subscriptions/:id/view", () => {
  test("records the view", async () => {
    const response = await request(app).post("/subscriptions/sub_1/view");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ recorded: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
