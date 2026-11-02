const request = require("supertest");
const { app } = require("../app");

describe("POST /subscriptions/:id/login", () => {
  test("records the login", async () => {
    const response = await request(app).post("/subscriptions/sub_1/login");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ recorded: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
